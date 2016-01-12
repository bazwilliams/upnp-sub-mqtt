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

function subscribe(location, device) {
  console.log(`${device.friendlyName} at ${location}`);
  if (device.serviceList && device.serviceList.service) {
    async.eachSeries(device.serviceList.service, function (service, iterCallback) {
      if (service.eventSubURL) {
        let eventUrlPath = url.resolve(location, service.eventSubURL);
        let eventUrl = url.parse(eventUrlPath);
        let sub = new Subscription(eventUrl.hostname, eventUrl.port, eventUrl.path);
        sub.on('message', announceMessageFor(device));
        sub.on('error', (e) => {
	  console.error(`${device.friendlyName}:${service.eventSubURL} ${e}`);
        });
	sub.on('subscribed', iterCallback);
      }
    });
  }
}

function process(device) {
  let location = device.location;
  if (!cache.has(location)) {
    cache.set(location, {});
    http.get(location, parsexmlresponse((err, data) => {
      if (err) {
          console.error(`${device.server}: ${err}`);
      } else if (data) {
          cache.set(location, data.root.device);
          subscribe(location, cache.get(location));
      } else {
          console.error(`${device.server}: returned no data`)
      }
    })).on('error', (e) => {
        console.error(`${device.server}: ${e}`);
    });
  }
}

ssdp.on('DeviceFound', process);
ssdp.on('DeviceAvailable', process);
ssdp.on('DeviceUpdate', process);
ssdp.on('DeviceUnavailable', console.log);

ssdp.mSearch();
