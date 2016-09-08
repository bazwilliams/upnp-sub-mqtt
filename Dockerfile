FROM node:4-slim

ENV MQTTHOST=mqtt://localhost

WORKDIR /usr/src/app

COPY . /usr/src/app

RUN npm install --production --quiet

ENTRYPOINT [ "npm", "run-script", "start" ]
