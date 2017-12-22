"use strict";

var _ = require('lodash');
var math = require('mathjs');
var wait = require('wait-for-stuff');
var log = require('loglevel');


//const sandboxURI = 'https://api-public.sandbox.gdax.com';

module.exports = function(gdax, product) {

    var self = this;
    // config
    var _buySize = 1;
    var _maxOpenedSells = 6;

    var _product = product;
    var _state = null; // the current state; 
    var _lastOrder = null;
    var _baseCurrency = product.split('-');
    var _quoteCurrency = _baseCurrency[1];
    var _tooManyOpenSells = true;
    _baseCurrency = _baseCurrency[0];
    var _accounts = wait.for.promise(gdax.getAccounts());
    log.debug(_baseCurrency, _accounts[_baseCurrency].available, _quoteCurrency, _accounts[_quoteCurrency].available);

    this.getState = function() { return _state; }

    this.trade = function(gdax, snapshot, spot, efficient) {

        var undervalued = spot < efficient; // true if undervalued, false if overvalued

        if((_state == null || _state == 'wtb')  && undervalued  && _accounts[_quoteCurrency].available > 0.000001)
        {
            this.updateOpenSells(gdax);
            if(!_tooManyOpenSells) this.placeBuyOrder(gdax, snapshot);
            else {
                // ask seller to help to sell
            }
        }
        else if(_state == 'wts') {
            this.placeSellOrder(gdax, snapshot, efficient);
        }  
        else if(_state == 'buy')
        {
            let bidTooLow = _lastOrder.price < snapshot[_product].bids[1].price;
            if(bidTooLow) log.info('bidTooLow', _lastOrder.price, '<', snapshot[_product].bids[1].price);
            this.checkOrder(gdax, snapshot, spot, efficient, !undervalued || bidTooLow);
        }
    }

    this.updateOpenSells = function(gdax) {
        gdax.getOrders().then((orders) => {
            var orders = _.takeWhile(orders, (order) => { return order.side == 'sell' });
            if(orders.length >= _maxOpenedSells || _accounts[_baseCurrency].available >= _maxOpenedSells)
            {
                gdax.getAccounts().then(accounts => { _accounts = accounts; }); // update the accounts asyncly
                _tooManyOpenSells = true;
                log.info('_tooManyOpenSells:', orders.length, _baseCurrency, 'available:', _accounts[_baseCurrency].available);
            }
            else _tooManyOpenSells = false;
        });
    }

    this.checkOrder = function(gdax, snapshot, spot, efficient, cancelOrder) {

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
                            _state = 'wtb';
                            log.info('_lastOrder cancelled without fill. Repeating', _state);
                        } else {
                            log.error('Exited. _lastOrder cancelled and partially filled:', _lastOrder);
                            process.exit();
                        }
                    } else if(_lastOrder.done_reason == 'filled') { // check order whether filled
                        log.info('bought', _lastOrder.size, '@', _lastOrder.price);
                        if(_lastOrder.side == 'buy') {
                            _state = 'wts'; // next tick try to sell
                        } else {
                            log.error('Exited. Cannot record _lastOrder.price because _lastOrder side unknown:', _lastOrder);
                            process.exit();
                        }
                    } else if(_lastOrder.status == 'rejected') {
                        _state = 'wtb';
                        log.info('_lastOrder rejected', _lastOrder.reject_reason);
                    } else {
                        log.error('Exited. _lastOrder settled with unknown done_reason:', _lastOrder);
                        process.exit();
                    }
                } else if(cancelOrder) {
                    if(Number(_lastOrder.filled_size) > 0) { // check whether order is partially filled
                        log.info('cancelling partially filled order...'); // cancel if only not started filling

                        // if cancel order due to bid to too low, we should hurry cancel buy
                        gdax.cancelOrder(_lastOrder.id).then(value=> {
                            // and then sell what ever has been bought at the now higher rate.
                            this.placeSellOrder(gdax, snapshot, efficient);
                            log.info('selling partial order of size', _lastOrder.filled_size);
                        });
                    } else {
                        gdax.cancelOrder(_lastOrder.id).then(value => {
                            log.info('cancel', _state);
                            _state = 'wtb';
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
          'size': _buySize,
          'type': 'limit',
          'post_only': true,
        };

        _lastOrder = wait.for.promise(gdax.buy(buyParams));
        if(_lastOrder.status != 'pending') {
        	log.error('cannot buy', _lastOrder);
        } else {
	        _state = 'buy';
	        log.info(_state, _lastOrder.size, '@', _lastOrder.price);
        }
    }

    this.placeSellOrder = function(gdax, snapshot, efficient) {
        var ask = _.find(snapshot[_product].asks, (ask) => { return ask.price > _lastOrder.price });
        var price = Math.max(ask.price, efficient, _lastOrder.price * 1.03);
        const sellParams = {
          'product_id': _product,
          'price': price,
          'size': _lastOrder.filled_size,
          'type': 'limit',
          'post_only': true,
        };

        var order = wait.for.promise(gdax.sell(sellParams));
        if(order.status != 'pending') {
            log.warn(order);
        } else {
            _state = 'wtb'; // prepare to start the next buy-sell pair
            log.info('sell', order.size, '@', order.price);
        }
    }
}
