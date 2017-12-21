"use strict";

var log = require('loglevel');
const WebSocket = require('ws');
const _ = require('lodash');
var wait = require('wait-for-stuff');
const Gdax = require('gdax');

module.exports = function(key, b64secret, passphrase, apiURI) {

    // initialization
    var self = this;
    const ws = new WebSocket('wss://ws-feed.gdax.com', { perMessageDeflate: false });
    var feed = {};
    var products = [0, 2, 4];
    var key = key;
    var b64secret = b64secret;
    var passphrase = passphrase;
    var apiURI = apiURI;
    var mock = true;
    var authedClient = new Gdax.AuthenticatedClient(key, b64secret, passphrase, apiURI);;

    this.live = function() {
        mock = false;
    }

    this.start = function(product_ids) {

        // initialize
        products = product_ids;
        _.each(products, product => {
            feed[product] = {
                'ticker': { price:0, last_size: 0, sequence: 0, volume: 0 },
                'bids': {}, // hash
                'asks': {}, // hash
            }
        });

        // open the GDAX WebSocket Feed
        ws.on('open',() => {
            var request = {
                "type": "subscribe",
                "channels": [
                        { "name": "level2", "product_ids": products },
                        { "name": "ticker", "product_ids": products }
                ]
            };
            ws.send(JSON.stringify(request));
        });

        if(ws.readyState !== ws.OPEN)
      	{
      		log.debug('Websocket not ready');
      		wait.for.predicate(() => { return ws.readyState == ws.OPEN });
      		log.debug('Websocket ready');
      	}

        // As the data streams in, update our data structures
        ws.on('message', data => {
            var data = JSON.parse(data);
            var product_id = data.product_id;
            if(data.type == 'snapshot') {
                _.each(data.bids, bid => {
                	let price = Number(bid[0]);
                	let size = Number(bid[1]);
                    feed[product_id].bids[price] = { 'price': price, 'size': size };
                });
                _.each(data.asks, ask => {
                	let price = Number(ask[0]);
                	let size = Number(ask[1]);
                    feed[product_id].asks[price] = { 'price': price, 'size': size };
                });
            } else if(data.type == 'l2update') {
                _.each(data.changes, change => {
                    var type = change[0];
                    var price = Number(change[1]);
                    var size = Number(change[2]);

                    if(size == 0 && type == 'buy') delete feed[product_id].bids[price];
                    else if(size == 0 && type == 'sell') delete feed[product_id].asks[price];
                    else {
                        var data = { 'price': price, 'size': size }
                        if(type == 'buy')       feed[product_id].bids[price] = data;
                        else if(type == 'sell') feed[product_id].asks[price] = data;
                    }
                });
            } else if(data.type == 'ticker') {
                if(data.sequence > feed[product_id].ticker.sequence)
                {
       			    // { type: 'ticker',
					  // sequence: 1707529262,
					  // product_id: 'ETH-USD',
					  // price: 651.13,
					  // open_24h: '736.79000000',
					  // volume_24h: '388070.47936022',
					  // low_24h: '651.13000000',
					  // high_24h: '736.82000000',
					  // volume_30d: '8730314.94006487',
					  // best_bid: '651.13',
					  // best_ask: '651.14',
					  // side: 'sell',
					  // time: '2017-12-15T12:44:24.164000Z',
					  // trade_id: 21429648,
					  // last_size: 0.00230368 }
                    data.price = Number(data.price);
                    data.last_size = Number(data.last_size || 0);
                    data.volume = feed[product_id].ticker.volume;
					/*
                    	selling = asking, buying = bidding
                    	if side = buy, then price is ask price, because buyer yield to seller, therefore spot price increase
                    	if side = sell, then price is buy price, because seller yield to buyer, therefore spot price decrease
                	*/
                    data.volume += data.last_size * (data.side === 'buy' ? 1 : -1);
                	feed[product_id].ticker = data;
                }
            }
        });
    	
    	ws.on('error', (err) => {
        	console.debug('Websocket errored:', err);
        	process.exit();
        });

        ws.on('close', (err) => {
        	console.debug('Websocket closed:', err);
        	process.exit();
        });

        return this;
    };

    this.getData = function () { 
        var data = {};
        _.each(products, product => {
        	data[product] = {
	        	'ticker': feed[product].ticker,
	        	'bids': _.orderBy(feed[product].bids, ['price'], ['desc']),
	        	'asks': _.orderBy(feed[product].asks, ['price'], ['asc']),
        	};
        });
        return data;
    }

    this.sell = function(params) {
        params = _.defaults(params, {
            'type': 'limit',
            'post_only': true,
        });

        if(mock)
        {
            return new Promise((resolve, reject) => {
                resolve({

                });
            });
        }
        else
        {
            return new Promise((resolve, reject) => {
                authedClient.sell(params, (err, res, data) => {
                    resolve(data);
                });
            });
        }
    }

    this.buy = function(params) {
        params = _.defaults(params, {
            'type': 'limit',
            'post_only': true,
        });

        if(mock)
        {
            return new Promise((resolve, reject) => {
                resolve({

                });
            });
        }
        else
        {
            return new Promise((resolve, reject) => {
                authedClient.buy(params, (err, res, data) => {
                    resolve(data);
                });
            });
        }
    }

    this.cancelOrder = function(orderID) {
        return new Promise((resolve, reject) => {
            authedClient.cancelOrder(orderID, (err, res, data) => {
                resolve(data);
            });
        });
    }

    this.getOrders = function() {
      return new Promise((resolve, reject) => {
          authedClient.getOrders((err, res, data) => {
            resolve(data);
          });
      })
    }

    this.getOrder = function(orderId) {
        /* Sell Order, Settled, filled
        { id: '2603eaa2-7605-494b-825c-4f9d4a2e090e',
          price: '0.01035000',
          size: '16.00000000',
          product_id: 'LTC-BTC',
          side: 'sell',
          stp: 'dc',
          type: 'limit',
          time_in_force: 'GTC',
          post_only: true,
          created_at: '2017-12-10T17:38:57.236022Z',
          done_at: '2017-12-11T13:14:13.665Z',
          done_reason: 'filled',
          fill_fees: '0.0000000000000000',
          filled_size: '16.00000000',
          executed_value: '0.1656000000000000',
          status: 'done',
          settled: true }

        // Buy order, Settled, filled
        { id: '3582948d-b94c-4618-94e6-3885f77d4c17',
          price: '0.01880000',
          size: '10.00000000',
          product_id: 'LTC-BTC',
          side: 'buy',
          stp: 'dc',
          type: 'limit',
          time_in_force: 'GTC',
          post_only: true,
          created_at: '2017-12-13T12:42:06.934187Z',
          done_at: '2017-12-13T17:38:21.405Z',
          done_reason: 'filled',
          fill_fees: '0.0000000000000000',
          filled_size: '10.00000000',
          executed_value: '0.1880000000000000',
          status: 'done',
          settled: true }

        // Buy Order, Not Settled
        { id: '5c8b1fd4-ad8e-4f67-bf2f-9c31d9808561',
          price: '0.00950000',
          size: '15.00000000',
          product_id: 'LTC-BTC',
          side: 'buy',
          stp: 'dc',
          type: 'limit',
          time_in_force: 'GTC',
          post_only: true,
          created_at: '2017-12-11T23:21:20.978612Z',
          fill_fees: '0.0000000000000000',
          filled_size: '0.00000000',
          executed_value: '0.0000000000000000',
          status: 'open',
          settled: false }

        // Sell Order, Not Settled
        { id: 'abd97766-e914-4d6c-9155-d245b074efd4',
          price: '0.02050000',
          size: '5.00000000',
          product_id: 'LTC-BTC',
          side: 'sell',
          stp: 'dc',
          type: 'limit',
          time_in_force: 'GTC',
          post_only: true,
          created_at: '2017-12-13T14:58:08.109769Z',
          fill_fees: '0.0000000000000000',
          filled_size: '0.00000000',
          executed_value: '0.0000000000000000',
          status: 'open',
          settled: false }

        // Buy Order, settled, cancelled (partial) fill
        { id: '8e00f7f3-4d2a-47f9-9846-9e244284ecc8',
          price: '0.01692000',
          size: '6.75180900',
          product_id: 'LTC-BTC',
          side: 'buy',
          stp: 'dc',
          type: 'limit',
          time_in_force: 'GTC',
          post_only: true,
          created_at: '2017-12-17T19:08:23.888704Z',
          done_at: '2017-12-17T19:08:53.919Z',
          done_reason: 'canceled',
          fill_fees: '0.0000000000000000',
          filled_size: '2.79840511',
          executed_value: '0.0473490144612000',
          status: 'done',
          settled: true }
        */

        return new Promise((resolve, reject) => {
            authedClient.getOrder(orderId, (err, res, data) => {
                resolve(data);
            });
        });
    }

    this.getAccounts = function() {
        // get accounts on GDAX
        return new Promise((resolve, reject) => {
            authedClient.getAccounts((err, res, data) => {
                var accounts = {};
                _.each(data, acc => {
                    accounts[acc.currency] = acc;
                });
                resolve(accounts);
            });
        });
    }
}
