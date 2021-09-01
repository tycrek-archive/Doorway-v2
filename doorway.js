// Load environment variables
require('dotenv').config();

// Import packages
const TLog = require('@tycrek/log');
const isProd = require('@tycrek/isprod')();
const express = require('express');
const xmlparser = require('express-xml-bodyparser');
const gpio = require('rpi-gpio').promise;
const VoiceResponse = require('twilio').twiml.VoiceResponse;

// Contacts
const CONTACTS = require('./contacts.json');

// Twilio client
const client = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

// Get app name and version
const { name: APP_NAME, version: APP_VERSION } = require('./package.json');

// Constants
const HOST = '0.0.0.0';
const PORT = 34917;
const GPIO_PIN = 7;

// Set up logging
const log = new TLog().enable.express().debug('Plugin enabled', 'Express');

// Welcome
log.info(APP_NAME, `v${APP_VERSION}`, isProd ? 'production' : 'development');

// Set up Express app
const app = express();
app.use(xmlparser());

// Index route, the call handler
app.post('/', (_req, res) => {
	// Create TwiML response
	const twiml = new VoiceResponse();

	// Create call Gather
	const gather = twiml.gather({
		action: '/gather',
		method: 'GET',
		input: 'dtmf',
		numDigits: 4
	});

	// Prompt user for code
	gather.say({ voice: 'alice' }, 'Please enter entry code');

	// If the user doesn't say anything, loop
	twiml.redirect('/');

	// Send TwiML response
	res.type('xml').send(twiml.toString());
});

// Gather route, handles user input
app.get('/gather', (req, res) => {
	const { Digits, From, FromCity, FromState, FromCountry } = req.query;
	const success = Digits === process.env.DOOR_CODE;
	const message = success ? 'Correct code' : 'Incorrect code';
	const location = `${FromCity}, ${FromState}, ${FromCountry}`;
	const caller = CONTACTS.find(({ numbers }) => numbers.includes(From))
	const contact = caller ? caller.name : From;

	// Log call & if entry was successful
	log.info('Call handled', contact, location);
	log[success ? 'success' : 'warn']('Entry', message);

	// If working in production, send a GPIO signal to the door
	if (isProd && success) gpio.setup(GPIO_PIN, gpio.DIR_OUT)
		.then(() => gpio.write(GPIO_PIN, false))
		.then(() => new Promise((resolve) => setTimeout(resolve, 1000)))
		.then(() => gpio.write(GPIO_PIN, true))
		.then(() => log.debug('GPIO sent', `Pin ${GPIO_PIN}`))
		.catch((err) => log.error('GPIO Error', err.toString()));

	// Send SMS notice to admin
	client.messages.create({ body: `${contact}: ${message}`, messagingServiceSid: process.env.TWILIO_SMS_SERVICE, to: CONTACTS[0].numbers[0] })
		.then(({ sid }) => log.debug('SMS SID', sid))
		.catch((err) => log.error('SMS Error', err.toString()));

	// Send TwiML response
	res.type('xml').send(new VoiceResponse().toString());
});

log.express().Host(app, PORT, HOST);
