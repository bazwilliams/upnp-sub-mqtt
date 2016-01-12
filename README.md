# upnp-sub-mqtt
Scans for Upnp devices, subscribes to any events and publishes the events to an MQTT broker

## Install

```
npm install -g upnp-sub-mqtt
```

## Run

```
upnp-sub-mqtt
```

Currently assumes you have an MQTT broker running at `mqtt://openwrt`.

Upnp events will be published to `upnp/event`. 

## TODO

[ ] Make broker host a configuration option
