"use strict";

var _ = require('lodash');
var math = require('mathjs');
var wait = require('wait-for-stuff');
var log = require('loglevel');



//const sandboxURI = 'https://api-public.sandbox.gdax.com';

module.exports = function(gdax, product) {

	var self = this;
	var _product = product;
	var _state0 = null; // the initial state; null initially; the bot will determine it's starting state based on circumstances; 
	var _state = null; // the current state; 
	var _lastOrder = null;
	var _lastBuyPrice = null;
	var _lastSellPrice = null;
	var _baseCurrency = product.split('-');
	var _quoteCurrency = _baseCurrency[1];
	var _tooManyOpenSells = true;
	_baseCurrency = _baseCurrency[0];
	var _accounts = wait.for.promise(gdax.getAccounts());
	log.debug(_baseCurrency, _accounts[_baseCurrency].available, _quoteCurrency, _accounts[_quoteCurrency].available);

    this.getState = function() { return _state; }

	this.trade = function(gdax, snapshot, spot, efficient) {

		var undervalued = spot < efficient; // true if undervalued, false if overvalued

		// if((_state == null || _state == 'wts') && !undervalued && _accounts[_baseCurrency].available > 0.000001)
		if(_state == 'wts')
		{
			this.placeSellOrder(gdax, snapshot, efficient);
			// log.info('SELL');
		}
		else if((_state == null || _state == 'wtb')  && undervalued  && _accounts[_quoteCurrency].available > 0.000001)
		{
			gdax.getOrders().then((err, res, data) => {
				var orders = _.takeWhile(data, (order) => { return order.side == 'sell' });
				if(orders.length > 8)
				{
					_tooManyOpenSells = true;
					log.info('_tooManyOpenSells:', orders.length);
				}
				else _tooManyOpenSells = false;
			});
			if(!_tooManyOpenSells) this.placeBuyOrder(gdax, snapshot);
			// log.info('BUY');
		}
		else if(_state == 'buy')
		{
			let bidTooLow = _lastOrder.price < snapshot[_product].bids[1].price;
			if(bidTooLow) log.info('bidTooLow', _lastOrder.price, '<', snapshot[_product].bids[1].price);
			this.checkOrder(gdax, 'bought', 'wts', 'wtb', !undervalued || bidTooLow);
		}
		else if(_state == 'sell')
		{
			let askTooHigh = _lastOrder.price > snapshot[_product].asks[1].price;
			this.checkOrder(gdax, 'sold', 'wtb', 'wts', undervalued || askTooHigh);
		}
	}

	this.checkOrder = function(gdax, verb, stateDone, stateCancelled, cancelOrder) {

		gdax.getOrder(_lastOrder.id).then(order => {
			if(order.message == 'NotFound') {
	        	log.error('Exited. _lastOrder not found:', _lastOrder);
	        	_lastOrder = null;
				process.exit();
	    	} else {
	            _lastOrder = order; // update order
	            log.info(_state, _lastOrder.filled_size, "/", _lastOrder.size, "@", _lastOrder.price);
	    	
	            if(_lastOrder.settled == true) {
	                _accounts = wait.for.promise(gdax.getAccounts());
	                if(_lastOrder.done_reason == 'canceled') {
	                    log.info('cancelled', _state, _lastOrder.size, '@', _lastOrder.price);
	                    if(!(Number(_lastOrder.filled_size) > 0)) { // cancelled and nothing filled, then we continue previous state
	                    	_state = stateCancelled;
	                    	log.info('_lastOrder cancelled without fill. Repeating', _state);
	                    } else {
	                    	log.error('Exited. _lastOrder cancelled and partially filled:', _lastOrder);
	                    	process.exit();
	                    }
	                } else if(_lastOrder.done_reason == 'filled') { // check order whether filled
	                    log.info(verb, _lastOrder.size, '@', _lastOrder.price);
	                    if(_lastOrder.side == 'buy') {
	                    	_lastBuyPrice = _lastOrder.price;
	                    	_state = stateDone;
	                    }
	                    else if(_lastOrder.side == 'sell') { _lastSellPrice = _lastOrder.price; _state = stateDone; }
	                    else {
	                    	log.error('Exited. Cannot record _lastOrder.price because _lastOrder side unknown:', _lastOrder);
	                    	process.exit();
	                    }
	                } else if(_lastOrder.status == 'rejected') {
	                	_state = stateCancelled;
	                    log.info('_lastOrder rejected', _lastOrder.reject_reason);
	                } else {
	                	log.error('Exited. _lastOrder settlled with unknown done_reason:', _lastOrder);
	                    process.exit();
	                }
	            } else if(cancelOrder) {
		            if(Number(_lastOrder.filled_size) > 0) { // check whether order is partially filled
		            	log.info('filling order, cannot cancel.'); // cancel if only not started filling

		            	// if cancel order due to bid to too low, we should hurry cancel buy
		            	// and then sell what ever has been bought at the now higher rate.

		            } else {
		                gdax.cancelOrder(_lastOrder.id).then(value => {
		                    log.info('cancel', _state);
		                    _state = stateCancelled;
		                });
		            }
		        }
		    }
	    });
    }

	this.placeBuyOrder = function(gdax, snapshot) {
		const buyParams = {
		  'product_id': _product,
		  'price': snapshot[_product].bids[0].price,
		  'size': 1,
		  'type': 'limit',
		  'post_only': true,
		};

		_lastOrder = wait.for.promise(gdax.buy(buyParams));
		_state = 'buy';
		log.debug(_lastOrder);
		log.info(_state, _lastOrder.size, '@', _lastOrder.price);
	}

	this.placeSellOrder = function(gdax, snapshot, efficient) {

		//let price = parseInt((Number(efficient) + Number(snapshot[_product].asks[0].price)) / 100000) * 100000;
		// if(price < snapshot[_product].asks[0].price) price = snapshot[_product].asks[0].price; // prevent immediate sell incase of a large fall
		var ask = _.find(snapshot[_product].asks, (ask) => { return ask.price > _lastOrder.price });
		var price = ask.price;
		const sellParams = {
		  'product_id': _product,
		  'price': price,
		  'size': 1, //_accounts[_baseCurrency].available,
		  'type': 'limit',
		  'post_only': true,
		};

		var order = wait.for.promise(gdax.sell(sellParams));
		log.debug(order);
		log.info('sell', order.size, '@', order.price);
		_state = 'wtb'; // prepare to start the next buy-sell pair
	}

}
