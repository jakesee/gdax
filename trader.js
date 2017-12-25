"use strict";

var _ = require('lodash');
var math = require('mathjs');
var wait = require('wait-for-stuff');
var log = require('loglevel');

var Trader = function(gdax, product, buySize) {
	var _gdax = gdax;
	var _buySize = buySize;
	var _product = product;
	var _state = 'wtb'; // null -> wtb
	var _lastOrder = null;
	var _baseCurrency = product.split('-');
	var _quoteCurrency = _baseCurrency[1];
	var _baseCurrency = _baseCurrency[0];
	var _accounts = wait.for.promise(_gdax.getAccounts());
	log.debug(_baseCurrency, _accounts[_baseCurrency].available, _quoteCurrency, _accounts[_quoteCurrency].available);
	
	this.state = function() { return _state; }

	this.buy = function(snapshot, spot, efficient, maxBid) {
		// objective: to buy at low prices and
		// place sell order at efficient price under maxBid
		// -----------------------------------------
		var undervalued = spot < efficient; 
		var overvalued = !undervalued;
		var safeBid = snapshot[_product].bids[0].price < maxBid;
		var haveMoney = _accounts[_quoteCurrency].available > 0.000001;
		if(_state == 'wtb' && undervalued && safeBid && haveMoney) {
			this.placeBuyOrder(snapshot);
		} else if(_state == 'wts') {
			this.placeSellOrder(snapshot, efficient, _lastOrder);
		} else if(_state == 'buy') { // need to check whether the order status
			let bidTooLow = _lastOrder.price < snapshot[_product].bids[1].price;
			this.checkBuyStatus(snapshot, spot, efficient, overvalued || bidTooLow);
		} else if(!safeBid) {
			log.debug(_product, 'not safeBid, time to sell.', snapshot[_product].bids[0].price, '>', maxBid);
		}
	}

	this.sell = function() {
		// objective: to gather all unsold baseCurrency coins
		// and sell them at or above their mean prices.
		// this method should only be called when the market has fallen rapidly
		// and we have to wait for the market to recover to sell the coins.
		// -----------------------------------------
	}

	this.placeBuyOrder = function(snapshot) {
		const buyParams = {
	      'product_id': _product,
	      'price': snapshot[_product].bids[0].price,
	      'size': _buySize,
	      'type': 'limit',
	      'post_only': true,
	    };
	    var order = wait.for.promise(_gdax.buy(buyParams));
	    if(order == null || order.status != 'pending') {
	    	// No state change. On next tick, the buy will attempt again
	    	log.error('cannot buy', order, buyParams);
	    } else {
	    	_lastOrder = order;
	        _state = 'buy';
	        log.info(_state, _product, _lastOrder.size, '@', _lastOrder.price);
	    }
	}

	this.placeSellOrder = function(snapshot, efficient, lastOrder) {
		var ask = _.find(snapshot[_product].asks, (ask) => { return ask.price > lastOrder.price });
        var price = price = Math.max(ask.price, parseInt(efficient * 100000) / 100000);
        const sellParams = {
          'product_id': _product,
          'price': price,
          'size': lastOrder.filled_size,
          'type': 'limit',
          'post_only': true,
        };

        var order = wait.for.promise(_gdax.sell(sellParams));
        if(order == null || order.status != 'pending') {
        	// No state change. On next tick, the sell will attempt again
            log.error('cannot sell', order, sellParams);
        } else {
            _state = 'wtb'; // prepare to start the next buy-sell pair
            log.info('sell', order.size, '@', order.price);
        }
	}

	this.checkBuyStatus = function(snapshot, spot, efficient, cancelOrder) {
		var order = wait.for.promise(_gdax.getOrder(_lastOrder.id));
		if(order.message == 'NotFound') { // cancelled manually or by cancelOrder flag
			log.error(_product, 'Exited. _lastOrder not found:', _lastOrder);
			process.exit();
		} else {
			_lastOrder = order; // update order;
			log.debug(_state, _product, _lastOrder.filled_size, '/', _lastOrder.size, '@', _lastOrder.price);
			if(_lastOrder.settled == true) {
				_gdax.getAccounts().then(accounts => { _accounts = accounts; }); // update accounts asyncly
				if(_lastOrder.done_reason == 'canceled') {
                    log.info('cancelled', _product, _state, _lastOrder.size, '@', _lastOrder.price);
                    _state = _lastOrder.filled_size > 0 ? 'wts' : 'wtb';
                } else if(_lastOrder.done_reason == 'filled') {
					log.info('bought', _product, _lastOrder.size, '@', _lastOrder.price);
					_state = 'wts';
				} else if(_lastOrder.status == 'rejected') {
                    _state = 'wtb';
                    log.info(_product, '_lastOrder rejected', _lastOrder.reject_reason);
                } else {
                    log.error(_product, 'Exited. _lastOrder settled with unknown done_reason:', _lastOrder);
                    process.exit();
                }
			} else if(cancelOrder) {
				log.info(_product, 'cancel', _state);
				_gdax.cancelOrder(_lastOrder.id); // immediately cancel buy asyncly
				_state = _lastOrder.filled_size > 0 ? 'wts' : 'wtb';
			}
		}
	}
}

module.exports = Trader;