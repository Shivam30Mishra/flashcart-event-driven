process.env.KAFKAJS_NO_PARTITIONER_WARNING =
  process.env.KAFKAJS_NO_PARTITIONER_WARNING || "1";

const { Kafka } = require("./requireServiceDependency")("kafkajs");
const config = require("./config");

const createKafka = (clientId = config.kafka.clientId) =>
  new Kafka({
    clientId,
    brokers: config.kafka.brokers,
    retry: {
      initialRetryTime: 300,
      retries: 100,
    },
    connectionTimeout: 3000,
    requestTimeout: 30000,
  });

const eventTopic = (eventType) => {
  switch (eventType) {
    case "ORDER_CREATED":
    case "PAYMENT_SUCCESS":
    case "PAYMENT_FAILED":
    case "ORDER_FAILED":
      return config.kafka.orderTopic;
    case "INVENTORY_RESERVED":
      return config.kafka.paymentTopic;
    default:
      return null;
  }
};

module.exports = { createKafka, eventTopic };
