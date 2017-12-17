var _ = require('lodash');
var math = require('mathjs');
var wait = require('wait-for-stuff');

const Gdax = require('gdax');
var config = {
    'key': process.env.gdKey,
    'b64secret': process.env.gdSecret,
    'passphrase': process.env.gdPassphrase,
    'apiURI': 'https://api.gdax.com',
}
//const sandboxURI = 'https://api-public.sandbox.gdax.com';

module.exports = function(product, baseAmount) {

	var self = this;
	var product = product;
	var state = null;
	var lastOrder = null;
	var accounts = {}
	var authedClient = new Gdax.AuthenticatedClient(config.key, config.b64secret, config.passphrase, config.apiURI);

	var baseCurrency = product.split('-');
	var quoteCurrency = baseCurrency[1];
	baseCurrency = baseCurrency[0];

	this.syncAccounts = async function () {
    	// get accounts on GDAX
    	return new Promise((resolve, reject) => {
    		authedClient.getAccounts((err, res, data) => {
	    		_.each(data, acc => {
	    			accounts[acc.currency] = acc;
	    		});

	    		resolve(accounts);
	    	});
    	});
    }
    wait.for.promise(this.syncAccounts());
    console.log('BTC:', accounts['BTC'].available, 'LTC:', accounts['LTC'].available)

	this.trade = function(snapshot, spot, efficient) {

		if((state == null || state == 'wts') && spot > efficient && accounts[baseCurrency].available > 0.00001)
		{
			lastOrder = wait.for.promise(this.placeSellOrder(snapshot, product));
			state = 'sell';
			console.log(lastOrder);
			console.log(state, lastOrder.size, '@', lastOrder.price);
		}
		else if((state == null || state == 'wtb')  && spot < efficient  && accounts[quoteCurrency].available > 0.00001)
		{
			lastOrder = wait.for.promise(this.placeBuyOrder(snapshot, product));
			state = 'buy';
			console.log(lastOrder);
			console.log(state, lastOrder.size, '@', lastOrder.price);
		}
		else if(state == 'buy')
		{
			console.log('buy', lastOrder.price, spot);
			if(spot <= lastOrder.price)
			{
				// check order whether filled
				this.getOrder(lastOrder.id).then(order => {
					lastOrder = order;
					if(lastOrder.settled == true)
					{
						this.syncAccounts();
						state = 'wts';
						console.log('bought', lastOrder.size, '@', lastOrder.price);
					}
				});
			}

			if(spot > efficient)
			{
				console.log('cancel buy');
				this.cancelOrder(lastOrder.id).then(value => {
					lastOrder = null;
					state = 'wtb';
				});
			}
		}
		else if(state == 'sell')
		{
			console.log('sell', lastOrder.price, spot);
			if(spot >= lastOrder.price)
			{
				// check order whether filled
				this.getOrder(lastOrder.id).then(order => {
					lastOrder = order;
					if(lastOrder.settled == true)
					{
						this.syncAccounts();
						state = 'wtb';
						console.log('sold', lastOrder.size, '@', lastOrder.price);
					}
				});
			}

			if(spot < efficient)
			{
				console.log('cancel sell');
				this.cancelOrder(lastOrder.id).then(value => {
					lastOrder = null;
					state = 'wts';
				});
			}
		}
	}

	this.placeBuyOrder = function(snapshot, product) {
		let size = parseInt(accounts[quoteCurrency].available / snapshot[product].bids[0].price * 1000000) / 1000000;
		const buyParams = {
		  'product_id': product,
		  'price': snapshot[product].bids[0].price,
		  'size': size,
		  'type': 'limit',
		  'post_only': true,
		};
		return new Promise((resolve, reject) => {
			authedClient.buy(buyParams, (err, res, data) => {
		    	resolve(data);
		    });
		});
	}

	this.placeSellOrder = function(snapshot, product) {
		const sellParams = {
		  'product_id': product,
		  'price': snapshot[product].asks[0].price,
		  'size': accounts[baseCurrency].available,
		  'type': 'limit',
		  'post_only': true,
		};
		return new Promise((resolve, reject) => {
			authedClient.sell(sellParams, (err, res, data) => {
		    	resolve(data);
		    });
		});
	}

	this.cancelOrder = function(orderID) {
		return new Promise((resolve, reject) => {
			authedClient.cancelOrder(orderID, (err, res, data) => {
				resolve(data);
			});
		});
	}

	this.getOrder = function(orderId) {
		/* Sell Order, Settled
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

		// Buy order, Settled
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
		*/

		return new Promise((resolve, reject) => {
			authedClient.getOrder(orderId, (err, res, data) => {
				resolve(data);
			});
		});
	}
}