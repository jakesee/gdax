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
	_baseCurrency = _baseCurrency[0];
	var _accounts = wait.for.promise(gdax.getAccounts());
	log.debug(_baseCurrency, _accounts[_baseCurrency].available, _quoteCurrency, _accounts[_quoteCurrency].available);

    this.getState = function() { return _state; }

	this.trade = function(gdax, snapshot, spot, efficient) {

		var undervalued = spot < efficient; // true if undervalued, false if overvalued

		if((_state == null || _state == 'wts') && !undervalued && _accounts[_baseCurrency].available > 0.000001)
		{
			this.placeSellOrder(gdax, snapshot);
		}
		else if((_state == null || _state == 'wtb')  && undervalued  && _accounts[_quoteCurrency].available > 0.000001)
		{
			this.placeBuyOrder(gdax, snapshot);
		}
		else if(_state == 'buy')
		{
			let bidTooLow = _lastOrder.price < snapshot[_product].bids[5].price;
			this.checkOrder(gdax, 'bought', 'wts', 'wtb', !undervalued, bidTooLow);
		}
		else if(_state == 'sell')
		{
			let askTooHigh = _lastOrder.price > snapshot[_product].asks[5].price;
			this.checkOrder(gdax, 'sold', 'wtb', 'wts', undervalued, askTooHigh);
		}
	}

	this.checkOrder = function(gdax, verb, stateDone, stateCancelled, cancelOrder, cancelFill) {

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
	                    if(_lastOrder.side == 'buy') _lastBuyPrice = _lastOrder.price;
	                    else if(_lastOrder.side == 'sell') _lastSellPrice = _lastOrder.price;
	                    else {
	                    	log.error('Exited. Cannot record _lastOrder.price because _lastOrder side unknown:', _lastOrder);
	                    	process.exit();
	                    }
	                } else {
	                	log.error('Exited. _lastOrder settlled with unknown done_reason:', _lastOrder);
	                    process.exit();
	                }
	            } else if(cancelOrder) {
	            	log.info('Cancelling Order...');
		            if(Number(_lastOrder.filled_size) > 0) { // check whether order is partially filled
		            	if(cancelFill) {
		            		gdax.cancelOrder(_lastOrder.id).then(value => {
			                    log.info('cancel', _state);
			                    _state = stateDone; // set to null because now don't know which position is better
			                });
		            	} else {
			                log.info('filling order, cannot cancel'); // cancel if only not started filling
		            	}
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
		// set initial state, this will determine our buy and sell price pairs
		if(_state0 === null) _state0 = 'buy';
		let size = 1; //parseInt(_accounts[_quoteCurrency].available / snapshot[_product].bids[3].price);
		if(_state0 === 'buy' || _lastSellPrice > snapshot[_product].bids[3].price) {
			const buyParams = {
			  'product_id': _product,
			  'price': snapshot[_product].bids[3].price,
			  'size': size,
			  'type': 'limit',
			  'post_only': true,
			};

			_lastOrder = wait.for.promise(gdax.buy(buyParams));
			_state = 'buy';
			log.debug(_lastOrder);
			log.info(_state, _lastOrder.size, '@', _lastOrder.price);
		} else {
			log.info('Cannot buy above last sell price: ', _lastSellPrice);
		}
	}

	this.placeSellOrder = function(gdax, snapshot) {
		// set initial state, this will determine our buy and sell price pairs
		if(_state0 === null) _state0 = 'sell';
		if(_state0 === 'sell' || _lastBuyPrice < snapshot[_product].asks[3].price) {
			const sellParams = {
			  'product_id': _product,
			  'price': snapshot[_product].asks[3].price,
			  'size': _accounts[_baseCurrency].available,
			  'type': 'limit',
			  'post_only': true,
			};

			_lastOrder = wait.for.promise(gdax.sell(sellParams));
			_state = 'sell';
			log.debug(_lastOrder);
			log.info(_state, _lastOrder.size, '@', _lastOrder.price);
		} else {
			log.info('Cannot sell below last buy price: ', _lastBuyPrice);
		}
	}

}
