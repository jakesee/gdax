"use strict";

/* Description
--------------------
This bot trades on GDAX, and his strategy wait for the current product
to become overvalued/undervalued (based on their respective USD prices) and then
placing a limit order to purchase at the current bid price.

Once the limit order fills completely, or cancelled, the filled amount is immediately
placed in a sell order at the current ask price or, if the efficient price is higher, then at the efficient price
because the bot expects the product price to move towards efficient price.

usage:
	var trader = new Trader(...)
	trader.sell(...) // to start off with selling to increase base currency
	trader.buy(...); // to start off with buying to increase qoute currency
*/

var _ = require('lodash');
var math = require('mathjs');
var wait = require('wait-for-stuff');
var log = require('loglevel');

/*
gdax
    Exchange object that provides the asyn REST functions to the GDAX exchange API
product
    The product to trade, e.g. LTC-BTC. This product must exist on GDAX.
tradesize
	Size of each bur order
maxBid
	The maximum price at which buying is allowed.
minAsk
	The lowest price at which selling is allowed.
return
    The trading bot object
*/
var Trader = function(gdax, product, tradeSize, maxBid, minAsk) {
	var _gdax = gdax;
	var _tradeSize = tradeSize;
	var _maxBid = maxBid;
	var _minAsk = minAsk;
	var _product = product;
	var _state = null;
	var _lastOrder = null;
	var _baseCurrency = product.split('-');
	var _quoteCurrency = _baseCurrency[1];
	var _baseCurrency = _baseCurrency[0];
	var _accounts = wait.for.promise(_gdax.getAccounts());
	log.debug(_baseCurrency, _accounts[_baseCurrency].available, _quoteCurrency, _accounts[_quoteCurrency].available);
	
	this.state = function() { return _state; }

	/*
	Description:
		use this function to start off with buying. the objective of this function is to profit/increase the quote currency
	snapshot
		A snapshot of the order book
	spot
		The current spot price
	efficient
		The current efficient price of the product. e.g. for LTC-BTC, the efficient price is calculated from LTC-USD and BTC-USD
	return
		null
	*/
	this.buy = function(snapshot, spot, efficient) {
		if(_state == null) _state = 'wtb';
		// objective: to buy at low prices and
		// place sell order at efficient price under _maxBid
		// -----------------------------------------
		var market = this.getMarketSituation(snapshot, spot, efficient);

		if(_state == 'wtb' && market.undervalued && market.safeBid && market.haveMoney) {
			this.bid(snapshot);
		} else if(_state == 'wts') {
			this.placeSellOrder(snapshot, efficient, _lastOrder);
		} else if(_state == 'buy') { // need to check whether the order status
			let bidTooLow = _lastOrder.price < snapshot[_product].bids[1].price;
			this.checkOrderStatus(snapshot, spot, efficient, market.overvalued || bidTooLow, 'wtb', 'wts', 'bought');
		} else if(!market.safeBid) {
			log.debug(_product, 'not safeBid, time to sell.', snapshot[_product].bids[0].price, '>', _maxBid);
		}
	}

	/*
	Description:
		use this function to start off with selling. the objective of this function is to profit/increase the base currency
	snapshot
		A snapshot of the order book
	spot
		The current spot price
	efficient
		The current efficient price of the product. e.g. for LTC-BTC, the efficient price is calculated from LTC-USD and BTC-USD
	return
		null
	*/
	this.sell = function(snapshot, spot, efficient) {
		if(_state == null) _state = 'wts';
		// objective: to gather all unsold baseCurrency coins
		// and sell them at or above their mean prices.
		// this method should only be called when the market has fallen rapidly
		// and we have to wait for the market to recover to sell the coins.
		// -----------------------------------------
		var market = this.getMarketSituation(snapshot, spot, efficient);

		if(_state == 'wts' && market.overvalued && market.safeAsk && market.haveProduct) {
			this.ask(snapshot);
		} else if(_state == 'wtb') {
			this.placeBuyOrder(snapshot, efficient, _lastOrder);
		} else if(_state == 'sell') { // need to check whether the order status
			let askTooHigh = _lastOrder.price > snapshot[_product].asks[1].price;
			this.checkOrderStatus(snapshot, spot, efficient, market.undervalued || askTooHigh, 'wts', 'wtb', 'sold');
		} else if(!market.safeAsk) {
			log.debug(_product, 'not safeAsk, time to buy.', snapshot[_product].asks[0].price, '<', _minAsk);
		}
	}

	this.getMarketSituation = function(snapshot, spot, efficient) {
		return {
			'undervalued': spot < efficient,
			'overvalued': spot > efficient,
			'safeBid': snapshot[_product].bids[0].price < _maxBid, // don't buy too high
			'safeAsk': snapshot[_product].asks[0].price > _minAsk, // don't sell too low
			'haveMoney': _accounts[_quoteCurrency].available >= snapshot[_product].bids[0].price,
			'haveProduct': _accounts[_baseCurrency].available > 11,
		};
	}

	this.bid = function(snapshot) {
		const buyParams = {
	      'product_id': _product,
	      'price': snapshot[_product].bids[0].price,
	      'size': _tradeSize,
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

	this.ask = function(snapshot) {
		const sellParams = {
	      'product_id': _product,
	      'price': snapshot[_product].asks[0].price,
	      'size': _tradeSize,
	      'type': 'limit',
	      'post_only': true,
	    };
	    var order = wait.for.promise(_gdax.sell(sellParams));
	    if(order == null || order.status != 'pending') {
	    	// No state change. On next tick, the sell will attempt again
	    	log.error('cannot sell', order, sellParams);
	    } else {
	    	_lastOrder = order;
	        _state = 'sell';
	        log.info(_state, _product, _lastOrder.size, '@', _lastOrder.price);
	    }
	}

	this.placeSellOrder = function(snapshot, efficient, lastOrder) {
		var ask = _.find(snapshot[_product].asks, (ask) => { return ask.price > lastOrder.price });
        var price = Math.max(ask.price, parseInt(efficient * 100000) / 100000);
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

	this.placeBuyOrder = function(snapshot, efficient, lastOrder) {
		var bid = _.find(snapshot[_product].bids, (bid) => { return bid.price < lastOrder.price });
        var price = Math.min(bid.price, parseInt(efficient * 100000) / 100000);
        const sellParams = {
          'product_id': _product,
          'price': price,
          'size': lastOrder.filled_size,
          'type': 'limit',
          'post_only': true,
        };

        var order = wait.for.promise(_gdax.sell(sellParams));
        if(order == null || order.status != 'pending') {
        	// No state change. On next tick, the buy will attempt again
            log.error('cannot buy', order, sellParams);
        } else {
            _state = 'wts'; // prepare to start the next sell-buy pair
            log.info('buy', order.size, '@', order.price);
        }
	}

	this.checkOrderStatus = function(snapshot, spot, efficient, cancelOrder, stateCancelled, stateDone, stateVerb) {
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
                    _state = _lastOrder.filled_size > 0 ? stateDone : stateCancelled;
                } else if(_lastOrder.done_reason == 'filled') {
					log.info(stateVerb, _product, _lastOrder.size, '@', _lastOrder.price);
					_state = stateDone;
				} else if(_lastOrder.status == 'rejected') {
                    _state = stateCancelled;
                    log.info(_product, '_lastOrder rejected', _lastOrder.reject_reason);
                } else {
                    log.error(_product, 'Exited. _lastOrder settled with unknown done_reason:', _lastOrder);
                    process.exit();
                }
			} else if(cancelOrder) {
				log.info(_product, 'cancel', _state);
				_gdax.cancelOrder(_lastOrder.id); // immediately cancel buy asyncly
				_state = _lastOrder.filled_size > 0 ? stateDone : stateCancelled;
			}
		}
	}
}

module.exports = Trader;