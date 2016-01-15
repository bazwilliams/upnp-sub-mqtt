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

function announceMessageFor(device) {
    return (message) => {
        let body = message['e:propertyset'] ? message['e:propertyset']['e:property'] : message;
        let msg = JSON.stringify({ body });
        client.publish(`upnp/${device.description.UDN}/event`, msg);
    };
}

function subscribe(path, device, callback) {
    let eventUrl = url.parse(path);
    let sub = new Subscription(eventUrl.hostname, eventUrl.port, eventUrl.path);
    sub.on('message', announceMessageFor(device));
    sub.on('error:unsubscribe', (e) => { console.error(`${device.friendlyName} ${e}`) });
    sub.on('error:resubscribe', (e) => { console.error(`${device.friendlyName} ${e}`) });
    sub.on('error:subscribe', callback);
    sub.on('subscribed', (data) => { callback(null, sub); });
}

function subscribeAll(usn, callback) {
    let device = devices.get(usn);
    async.eachSeries(Array.from(device.subscriptions.keys()), (path, iterCallback) => {
        subscribe(path, device, (err, subscription) => {
            if (err) {
                console.error(`Failed to setup subscription to ${path}`);
                iterCallback(err);
            } else {
                devices.get(usn).subscriptions.set(path, subscription);
                iterCallback();
            }
        });
    }, callback);
}

function unsubscribeAll(usn, callback) {
    let device = devices.get(usn);
    async.eachSeries(Array.from(device.subscriptions.values()), (subscription, iterCallback) => {
        subscription.unsubscribe();
        subscription.on('unsubscribe', iterCallback);
    }, callback);
}

function populateSubscriptions(device, location, usn) {
    if (device.serviceList && device.serviceList.service) {
        if (Array.isArray(device.serviceList.service)) {
            for (let service of device.serviceList.service) {
                if (service.eventSubURL) {
                    let path = url.resolve(location, service.eventSubURL);
                    devices.get(usn).subscriptions.set(path, {});
                }
            }
        } else {
            if (device.serviceList.service.eventSubURL) {
                let path = url.resolve(location, device.serviceList.service.eventSubURL);
                devices.get(usn).subscriptions.set(path, {});
            }
        }
    }
}

function unprocess(discovery) {
    if (devices.has(discovery.usn)) {
        unsubscribeAll(discovery.usn);
        devices.delete(discovery.usn);
    }
}

function process(discovery, callback) {
    if (!processed.has(discovery.location)) {
        processed.add(discovery.location);
        http.get(discovery.location, parsexmlresponse((err, data) => {
            if (err) {
                console.error(`${discovery.server}@${discovery.location} [${discovery.usn}]: ${err}`);
                processed.delete(discovery.location);
                callback(err);
            } else if (data) {
                devices.set(discovery.usn, { description: data.root.device, subscriptions: new Map() });
                populateSubscriptions(devices.get(discovery.usn).description, discovery.location, discovery.usn);
                subscribeAll(discovery.usn, callback);
            } else {
                callback(new Error(`${discovery.server}: returned no data`));
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
        process(discoveredDevice, (err, data) => {
            if (err) {
                console.error(err);
            }
            processQueue();
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
    unprocess(discovery, (err) => console.error(err));
    process(discovery, (err) => console.error(err));
});
ssdp.on('DeviceUnavailable', (discovery) => {
    unprocess(discovery, (err) => console.error(err));
});

ssdp.mSearch();
