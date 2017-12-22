"use strict";

// utility
var tick = require('animation-loops');
var columnify = require('columnify');
var _ = require('lodash');
// formatting numbers: http://mathjs.org/docs/reference/functions/format.html
// logging
var log = require('loglevel');
log.setLevel(process.env.logLevel);

// GDAX exchange client
var config = {
    'key': process.env.gdKey,
    'b64secret': process.env.gdSecret,
    'passphrase': process.env.gdPassphrase,
    'apiURI': 'https://api.gdax.com',
}
var Gdax = require('./gdax.js');
var gdax = new Gdax(config.key, config.b64secret, config.passphrase, config.apiURI);
gdax.start(['BTC-USD', 'LTC-USD', 'LTC-BTC']).live();

// trader
var seller = require('./seller.js');
var GDAXTrader = require('./gdax-trader.js');
var trader = new GDAXTrader(gdax, 'LTC-BTC');
seller = new seller(gdax, 'LTC-BTC', 0.65);

// game loop
var lastTime = 0;
tick.add((elapsed, delta, stop) => {

	if(elapsed - lastTime < 4000) return; // too early

	lastTime = elapsed;

	// get a copy of the data to work on
	// so the the internal copy can keep up dating without problems
	var snapshot = gdax.getData(); // this data may be outdated by milliseconds

	// { type: 'ticker',
	//   sequence: 4558296748,
	//   product_id: 'BTC-USD',
	//   price: '16798.99000000',
	//   open_24h: '17067.22000000',
	//   volume_24h: '26496.61688101',
	//   low_24h: '16798.99000000',
	//   high_24h: '17746.73000000',
	//   volume_30d: '951575.24393951',
	//   best_bid: '16798.99',
	//   best_ask: '16799',
	//   side: 'sell',
	//   time: '2017-12-14T04:41:36.789000Z',
	//   trade_id: 28187314,
	//   last_size: '0.01900000' }

	var spot = Number(snapshot['LTC-BTC'].ticker.price);
	var efficient = Number(snapshot['LTC-USD'].ticker.price) / Number(snapshot['BTC-USD'].ticker.price);
	efficient = parseInt(efficient * 100000) / 100000;
	log.debug(trader.getState(), "spot, efficient", spot, efficient);
	try
	{
		trader.trade(gdax, snapshot, spot, efficient);
		// var state = trader.trade(gdax, snapshot, spot, efficient);
		// log.debug(state, "spot, efficient", spot, efficient);
		// if(sellerActive == false && state == 'broke') sellerActive = true;
		// if(sellerActive == true) {
		// 	state = seller.trade(gdax, snapshot, spot, efficient);
		// 	if(state == 'done') sellerActive = false;
		// }
	}
	catch(err)
	{
		log.trace(err);
		process.exit();
	}
});