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

let program = require('commander');

program
    .version(require('./package.json').version)
    .option('-u, --url <url>', 'Set the URI of the broker [mqtt://localhost]')
    .parse(process.argv);

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
        let msg = JSON.stringify(extractProperties(message));
        client.publish(`upnp/${device.description.UDN}/${service.serviceId}`, msg);
    };
}

function subscribe(path, usn, callback) {
    let eventUrl = url.parse(path);
    let sub = new Subscription(eventUrl.hostname, eventUrl.port, eventUrl.path, 10);
    let deviceDescription = devices.get(usn).description;
    sub.on('error', callback);
    sub.on('subscribed', (data) => {
        if (!data.sid) {
            callback(new Error(`Received no sid for subscription to ${path}`));
        } else {
            sub.on('message', announceMessageFor(usn, data.sid));
            sub.once('error:resubscribe', (e) => {
                console.error(`Failed to resubscribe: ${deviceDescription.friendlyName} ${e.error}`);
                unprocess(usn, () => {});
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
    devices.delete(usn);
    processed.delete(device.location);
    async.each(Array.from(device.subscriptions.keys()), (sid, iterCallback) => {
        let subscription = device.subscriptions.get(sid);
        console.log(`Unsubscribing ${sid} (${subscription.serviceId})`);
        let callbackInvoked = false;
        subscription.subscription.on('unsubscribed', (data) => {
            if (!callbackInvoked) {
                callbackInvoked = true;
                iterCallback();
            }
        });
        subscription.subscription.on('error:unsubscribe', (err) => {
            if (!callbackInvoked) {
                callbackInvoked = true;
                if (err) {
                    console.error(err);
                } else {
                    console.error(`Unknown error unsubscribing from ${sid} (${subscription.serviceId})`);
                }
                iterCallback();
            }
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
                console.log(`Removing ${usn} from devices`);
                callback();
            }
        });
    } else {
        callback();
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
                if (data.root) {
                    devices.set(discovery.usn, { location: discovery.location, description: data.root.device, subscriptions: new Map() });
                    let services = findServices(devices.get(discovery.usn).description, discovery.location, discovery.usn);
                    subscribeAll(discovery.usn, services, callback);
                } else {
                    console.error(new Error(`Failed to parse description of ${discovery.server} at ${discovery.location}`));
					callback();
                }
            } else {
                console.error(new Error(`Failed to download description of ${discovery.server}: returned no data`));
                callback();
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
                console.error(err);
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

function unsubscribeAllDevices() {
    for(let usn of devices.keys()) {
        unsubscribeAllSync(usn);
    }
    process.exit();
}

function handleException(e) {
    console.error(e.stack);
    unsubscribeAllDevices();
}

process.title = 'upnp-sub-mqtt';

process.stdin.resume();//so the program will not close instantly

process.on('exit', unsubscribeAllDevices);
process.on('SIGINT', unsubscribeAllDevices);
process.on('uncaughtException', handleException);

ssdp.on('DeviceFound', (discovery) => {
    subscriptionQueue.push(discovery)
});
ssdp.on('DeviceAvailable', (discovery) => {
    subscriptionQueue.push(discovery)
});
ssdp.on('DeviceUpdate', (discovery) => {
    unprocess(discovery.usn, (err) => {
        if (err) {
            console.error(`Error unprocessing after device update ${discovery.usn}: ${err}`)
        }
    });
    processDiscovery(discovery, (err) => {
        if (err) {
            console.error(`Error processing ${discovery.usn}: ${err}`)
        }
    });
});
ssdp.on('DeviceUnavailable', (discovery) => {
    unprocess(discovery.usn, (err) => {
        if (err) {
            console.error(`Error unprocessing after device unavailable: ${discovery.usn}: ${err}`)
        }
    });
});

let client = mqtt.connect(program.url || 'mqtt://localhost');
console.log(`Connecting: ${client.options.href}`);

client.on('connect', (connack) => {
    console.log('Connected');
    if (!connack.sessionPresent) {
        setTimeout(processQueue, 1000);
        ssdp.mSearch();
    }
});

client.on('error', (err) => {
    console.error(`MQTT Client Error: ${err}`);
})
