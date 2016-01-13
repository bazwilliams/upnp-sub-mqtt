#!/usr/bin/env node
"use strict";

let ssdp = require('node-upnp-ssdp');
let Subscription = require('node-upnp-subscription');
let parsexmlresponse  = require('parsexmlresponse');
let http = require('http');
let url = require('url');
let mqtt = require('mqtt');
let async = require('async');

let cache = new Map();
let client = mqtt.connect('mqtt://openwrt');

function announceMessageFor(device) {
    return (message) => {
        let msg = JSON.stringify({ body: { device, message: message } });
        client.publish('upnp/event', msg);
    };
}

function subscribe(path, device, callback) {
    let eventUrl = url.parse(path);
    let sub = new Subscription(eventUrl.hostname, eventUrl.port, eventUrl.path);
    sub.on('message', announceMessageFor(device));
    sub.on('error', (e) => { console.error(`${device.friendlyName} ${e}`); });
    sub.on('subscribed', (data) => { callback(null, data); });
}

function subscribeAll(usn) {
    //console.log('subscribing to:');
    //console.log(cache.get(usn));
}

function unSubscribeAll(usn) {
//    console.log('unsubscribing from:');
//    console.log(cache.get(usn));
}

function populateSubscriptions(device, location, usn) {
    //console.log(`${device.friendlyName} at ${location}`);
    if (device.serviceList && device.serviceList.service) {
        if (Array.isArray(device.serviceList.service)) {
            for (let service of device.serviceList.service) {
                if (service.eventSubURL) {
                    let path = url.resolve(location, service.eventSubURL);
                    cache.get(usn).set(path, {});
                }
            }
        } else {
            if (device.serviceList.service.eventSubURL) {
                let path = url.resolve(location, device.serviceList.service.eventSubURL);
                cache.get(usn).set(path, {});
            }
        }
    }
}

function unprocess(device) {
    if (cache.has(device.usn)) {
        unSubscribeAll(device.usn);
        cache.delete(device.usn);
    }
}

function process(device) {
    if (!cache.has(device.usn)) {
        cache.set(device.usn, new Map());
        http.get(device.location, parsexmlresponse((err, data) => {
            if (err) {
                console.error(`${device.server}@${device.location} [${device.usn}]: ${err}`);
                cache.delete(device.usn);
            } else if (data) {
                populateSubscriptions(data.root.device, device.location, device.usn);
                subscribeAll(device.usn);
            } else {
                console.error(`${device.server}: returned no data`)
            }
        })).on('error', (err) => {
            console.error(`${device.server}@${device.location} [${device.usn}]: ${err}`);
            cache.delete(device.usn);
        });
    }
}

ssdp.on('DeviceFound', process);
ssdp.on('DeviceAvailable', process);
ssdp.on('DeviceUpdate', (device) => {
    unprocess(device);
    process(device);
});
ssdp.on('DeviceUnavailable', unprocess);

ssdp.mSearch();
