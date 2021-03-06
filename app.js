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
var Trader = require('./trader.js');
var traderLTC = new Trader(gdax, 'LTC-BTC', 1, 9999, 0.01100);

// game loop
var lastTime = 0;
tick.add((elapsed, delta, stop) => {

	if(elapsed - lastTime < 5000) return; // too early

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

	try
	{
		var ltc = {
			'trader': traderLTC.state(),
			'product': 'LTC-BTC',
			'spot': Number(snapshot['LTC-BTC'].ticker.price),
			'efficient': parseInt(Number(snapshot['LTC-USD'].ticker.price) / Number(snapshot['BTC-USD'].ticker.price) * 1000000) / 1000000
		}
		log.debug(columnify([ltc]));		
		traderLTC.buy(snapshot, ltc.spot, ltc.efficient);
	}
	catch(err)
	{
		log.trace(err);
		process.exit();
	}
});