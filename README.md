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
