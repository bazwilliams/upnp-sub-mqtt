[![Build Status](https://travis-ci.org/bazwilliams/upnp-sub-mqtt.svg?branch=master)](https://travis-ci.org/bazwilliams/upnp-sub-mqtt) [![](https://images.microbadger.com/badges/image/bazwilliams/upnp-sub-mqtt.svg)](http://microbadger.com/images/bazwilliams/upnp-sub-mqtt "Get your own image badge on microbadger.com")  [![](https://images.microbadger.com/badges/version/bazwilliams/upnp-sub-mqtt.svg)](http://microbadger.com/images/bazwilliams/upnp-sub-mqtt "Get your own version badge on microbadger.com")  [![](https://images.microbadger.com/badges/commit/bazwilliams/upnp-sub-mqtt.svg)](http://microbadger.com/images/bazwilliams/upnp-sub-mqtt "Get your own commit badge on microbadger.com")  [![](https://images.microbadger.com/badges/license/bazwilliams/upnp-sub-mqtt.svg)](http://microbadger.com/images/bazwilliams/upnp-sub-mqtt "Get your own license badge on microbadger.com")

# upnp-sub-mqtt

Scans for Upnp devices, subscribes to any events and publishes the events to an MQTT broker

## Docker

```
docker run --net=host -e MQTTHOST=<MQTT_HOST> bazwilliams/upnp-sub-mqtt
```

* MQTTHOST - Defaults to `mqtt://localhost`, set to your mqtt broker. 

## Install

```
npm install -g upnp-sub-mqtt
```

## Run

```
upnp-sub-mqtt -u <brokerURL>
```

### Options

* `-v` Version
* `-u` `--url` URL of broker, defaults to `mqtt://localhost`

## Message Output

Upnp events will be published to `upnp/${usn}/${serviceId}`.
