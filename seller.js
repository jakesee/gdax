"use strict";

var _ = require('lodash');
var math = require('mathjs');
var wait = require('wait-for-stuff');
var log = require('loglevel');
var columnify = require('columnify');
var wait = require('wait-for-stuff');

module.exports = function(gdax, product, initialAccount) {

    var _state = null;
    var _accounts = null;
    var _sellOrder = { 'target': initialAccount, 'balance': null, 'price': null, 'size': 0, 'mean': null };
    var _product = product;
    var _baseCurrency = product.split('-');
    var _quoteCurrency = _baseCurrency[1];
    var _lastOrder = null;
    _baseCurrency = _baseCurrency[0];

    this.getState = function() { return _state; }

    this.trade = function(gdax, snapshot, spot, efficient) {

        if(_state == null)
        {
            var promises = [gdax.getAccounts(), gdax.getOrders()];
            var values = wait.for.promise(Promise.all(promises));
            _accounts = values[0];
            var orders = _.takeWhile(values[1], (order) => { return order.side == 'sell' });
            if(orders.length > 0) {
                var revenue = _.reduce(orders, (total, order) => {return total + Number(order.price * (order.size - order.filled_size))}, 0);
                _sellOrder.size = _.reduce(orders, (total, order) => {return total + Number(order.size - order.filled_size)}, 0);
                _sellOrder.size = _sellOrder.size + Number(_accounts[_baseCurrency].available);
                _sellOrder.mean = revenue / _sellOrder.size;
                _sellOrder.balance = _sellOrder.target - Number(_accounts[_quoteCurrency].available);
                _sellOrder.price = _sellOrder.balance / _sellOrder.size;
                _sellOrder.price = parseInt(_sellOrder.price * 1000000) / 1000000;

                // cancel all sells and consolidate
                var cancels = _.map(orders, order => gdax.cancelOrder(order.id));
                wait.for.promise(Promise.all(cancels));
                _state = 'wts';
                log.info('sell order:', _sellOrder);
                process.exit();
            } else {
                _state = 'done'; // nothing to do anymore
            }
        } else if(_state == 'wts') {

            this.placeSellOrder(gdax, snapshot, efficient);

        } else if(_state == 'sell') {

            gdax.getOrder(_lastOrder.id).then(order => {
                if(order.message == 'NotFound') {
                    log.error('Exited. _lastOrder not found:', _lastOrder);
                    _lastOrder = null;
                    _state = 'done';
                } else {
                    _lastOrder = order; // update order
                    log.info(_state, _lastOrder.filled_size, "/", _lastOrder.size, "@", _lastOrder.price);

                    if(_lastOrder.settled == true) {
                        if(_lastOrder.done_reason == 'canceled') {
                            _state = 'wts';
                            log.info('_lastOrder canceled');
                        } else if(_lastOrder.done_reason == 'filled') {
                            _state = 'wts';
                            log.info('sold', _lastOrder.size, '@', _lastOrder.price, '=', _lastOrder.size * _lastOrder.price);
                        } else if(_lastOrder.status == 'rejected') {
                            _state = 'wts';
                            log.info('_lastOrder rejected', _lastOrder.reject_reason);
                        } else {
                            log.error('Exited. _lastOrder settled with unknown done_reason:', _lastOrder);
                            _state = 'done';
                        }
                    }
                }
            });
        }
    }

    this.placeSellOrder = function(gdax, snapshot, efficient) {

        var price = math.max(snapshot[_product].asks[0], _sellOrder.price);
        var size = _sellOrder.size > 1 ? 1 : _sellOrder.size; // sell 1 by 1
        
        const sellParams = {
          'product_id': _product,
          'price': price,
          'size': size,
          'type': 'limit',
          'post_only': true,
        };

        var order = wait.for.promise(gdax.sell(sellParams));
        if(order.status != 'pending') {
            log.warn(order, sellParams);
        } else {
            _lastOrder = order;
            _state = 'sell'; // prepare to start the next buy-sell pair
            log.info('sell', _lastOrder.size, '@', _lastOrder.price);
        }
    }
};
