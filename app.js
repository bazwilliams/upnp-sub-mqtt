#!/usr/bin/env node
"use strict";

let ssdp = require('node-upnp-ssdp');
let Subscription = require('node-upnp-subscription');
let parsexmlresponse  = require('parsexmlresponse');
let http = require('http');
let url = require('url');
let mqtt = require('mqtt');
let async = require('async');

let devices = new Map();
let processed = new Set();
let subscriptionQueue = [];
let client = mqtt.connect('mqtt://openwrt');

function kvToObject(arr) {
    return arr.reduce((memo, val) => {
        memo[Object.keys(val)[0]] = val[Object.keys(val)[0]];
        return memo;
    }, {});
}

function extractProperties(message) {
    let properties = message['body'] ? message['body'] : message;
    properties = properties['e:propertyset'] ? properties['e:propertyset']['e:property'] : properties;
    if (Array.isArray(properties)) {
        return kvToObject(properties);
    } else {
        return properties;
    }
}

function announceMessageFor(usn, sid) {
    let device = devices.get(usn);
    return (message) => {
        let service = device.subscriptions.get(sid);
        let msg = JSON.stringify({ body: extractProperties(message) });
        client.publish(`upnp/${device.description.UDN}/${service.serviceId}`, msg);
    };
}

function subscribe(path, usn, callback) {
    let eventUrl = url.parse(path);
    let sub = new Subscription(eventUrl.hostname, eventUrl.port, eventUrl.path);
    let deviceDescription = devices.get(usn).description;
    sub.on('error:subscribe', callback);
    sub.on('subscribed', (data) => {
        if (!data.sid) {
            callback(new Error(`Received no sid for subscription to ${path}`));
        } else {
            sub.on('message', announceMessageFor(usn, data.sid));
            sub.on('error:resubscribe', (e) => {
                console.error(`${deviceDescription.friendlyName} ${e}`)
            });
            callback(null, {sid: data.sid, subscription: sub});
        }
    });
}

function subscribeAll(usn, services, callback) {
    async.eachSeries(services, (service, iterCallback) => {
        console.log(`Subscribing ${usn} (${service.serviceId})`);
        subscribe(service.path, usn, (err, data) => {
            if (err) {
                console.error(`Failed to setup subscription to ${service.path}`);
                iterCallback(err);
            } else {
                devices.get(usn).subscriptions.set(data.sid, { serviceId: service.serviceId, subscription: data.subscription });
                iterCallback();
            }
        });
    }, callback);
}

function unsubscribeAll(usn, callback) {
    let device = devices.get(usn);
    async.eachSeries(Array.from(device.subscriptions.keys()), (sid, iterCallback) => {
        let subscription = device.subscriptions.get(sid);
        console.log(`Unsubscribing ${sid} (${subscription.serviceId})`);
        subscription.subscription.on('unsubscribe', (data) => iterCallback());
        subscription.subscription.on('error:unsubscribe', (err) => {
            console.error(err);
            iterCallback();
        });
        subscription.subscription.unsubscribe();
    }, callback);
}

function unsubscribeAllSync(usn) {
    let device = devices.get(usn);
    for (let sid of device.subscriptions.keys()) {
        let subscription = device.subscriptions.get(sid);
        console.log(`Unsubscribing ${sid} (${subscription.serviceId})`);
        subscription.subscription.unsubscribe();
    }
}

function findServices(device, location) {
    let services = [];
    function addService(service) {
        if (service.eventSubURL) {
            let path = url.resolve(location, service.eventSubURL);
            let serviceId = service.serviceId;
            services.push({ serviceId, path });
        }
    }
    if (device.serviceList && device.serviceList.service) {
        if (Array.isArray(device.serviceList.service)) {
            for (let service of device.serviceList.service) {
                addService(service);
            }
        } else {
            addService(device.serviceList.service);
        }
    }
    return services;
}

function unprocess(usn, callback) {
    if (devices.has(usn)) {
        unsubscribeAll(usn, (err, data) => {
            if (err) {
                callback(err);
            } else {
                devices.delete(usn);
                callback();
            }
        });
    }
}

function processDiscovery(discovery, callback) {
    if (!processed.has(discovery.location)) {
        processed.add(discovery.location);
        http.get(discovery.location, parsexmlresponse((err, data) => {
            if (err) {
                console.error(`${discovery.server}@${discovery.location} [${discovery.usn}]: ${err}`);
                processed.delete(discovery.location);
                callback(err);
            } else if (data) {
                devices.set(discovery.usn, { description: data.root.device, subscriptions: new Map() });
                let services = findServices(devices.get(discovery.usn).description, discovery.location, discovery.usn);
                subscribeAll(discovery.usn, services, callback);
            } else {
                callback(new Error(`Failed to download description of ${discovery.server}: returned no data`));
            }
        })).on('error', (err) => {
            console.error(`${discovery.server}@${discovery.location} [${discovery.usn}]: ${err}`);
            processed.delete(discovery.location);
            callback(err);
        });
    } else {
        callback();
    }
}

function processQueue() {
    let discoveredDevice = subscriptionQueue.shift();
    if (discoveredDevice) {
        processDiscovery(discoveredDevice, (err, data) => {
            if (err) {
                console.log('Rolling back subscriptions');
                unprocess(discoveredDevice.usn, (err, data) => {
                    subscriptionQueue.push(discoveredDevice);
                    processQueue();
                });
            } else {
                processQueue();
            }
        });
    } else {
        setTimeout(processQueue, 1000);
    }
}


setTimeout(processQueue, 1000);

ssdp.on('DeviceFound', (discovery) => {
    subscriptionQueue.push(discovery)
});
ssdp.on('DeviceAvailable', (discovery) => {
    subscriptionQueue.push(discovery)
});
ssdp.on('DeviceUpdate', (discovery) => {
    unprocess(discovery.usn, (err) => console.error(err));
    processDiscovery(discovery, (err) => console.error(err));
});
ssdp.on('DeviceUnavailable', (discovery) => {
    unprocess(discovery.usn, (err) => console.error(err));
});

function unsubscribeAllDevices() {
    for(let usn of devices.keys()) {
        unsubscribeAllSync(usn);
    }
    process.exit();
}

process.stdin.resume();//so the program will not close instantly

function handleException(e) {
    console.error(e.stack);
    unsubscribeAllDevices();
}

process.on('exit', unsubscribeAllDevices);
process.on('SIGINT', unsubscribeAllDevices);
process.on('uncaughtException', handleException);

ssdp.mSearch();
