const EventEmitter = require('events');

// Global event bus for real-time attendance broadcasts across HTTP & SSE
const eventBus = new EventEmitter();

// Increase max listeners for multiple simultaneous admin tabs
eventBus.setMaxListeners(50);

module.exports = eventBus;
