"use strict";

var _ = require('lodash');
var math = require('mathjs');
var wait = require('wait-for-stuff');
var log = require('loglevel');
var columnify = require('columnify');
var wait = require('wait-for-stuff');

module.exports = function(gdax, product, initialAccount) {

    var _targetMin = initialAccount;
    var _accounts = null;
    var _state = null;
    var _product = product;
    var _baseCurrency = product.split('-');
    var _quoteCurrency = _baseCurrency[1];
    var _sellOrder = { 'price': null, 'size': 0 };
    var _lastOrder = null;
    _baseCurrency = _baseCurrency[0];


    this.trade = function(gdax, snapshot, spot, efficient) {

        if(_state == null)
        {
            _accounts = wait.for.promise(gdax.getAccounts());

            // get all the sells
            var orders = wait.for.promise(gdax.getOrders());
            orders = _.takeWhile(orders, (order) => { return order.side == 'sell' });
            if(orders.length > 0) {
                var mean = _.reduce(orders, (total, order) => {return total + Number(order.price * (order.size - order.filled_size))}, 0);
                _sellOrder.size = _.reduce(orders, (total, order) => {return total + Number(order.size - order.filled_size)}, 0);
                mean = mean / _sellOrder.size;
                var worth = _sellOrder.size * mean;
                var targetTotal = Number(_accounts[_quoteCurrency].available) + worth;
                console.log(columnify(orders));
                console.log('sell', _sellOrder.size, '@', mean, '=', worth, 'available', _accounts[_quoteCurrency].available, 'targetTotal', targetTotal);
                _sellOrder.price = (_targetMin - _accounts[_quoteCurrency].available) / _sellOrder.size;
                console.log('min sell', _sellOrder.size, '@', _sellOrder.price);

                process.exit();

                if(_sellOrder.price > mean) {
                    console.log('Confirm? _sellOrder.price > mean:', _sellOrder.price, '>', mean);
                    process.exit();
                } else {
                    // cancel all sells and consolidate
                    var cancels = _.map(orders, order => gdax.cancelOrder(order.id));
                    Promise.all(cancels).then(values => { _state = 'wts' });
                }
            } else {
                console.log('Nothing to sell');
                process.exit();
            }
            _state = 'processing';

        } else if(_state == 'wts') {

            this.placeSellOrder(gdax, snapshot, efficient);

        } else if(_state == 'sell') {

            gdax.getOrder(_lastOrder.id).then(order => {
                if(order.message == 'NotFound') {
                    log.error('Exited. _lastOrder not found:', _lastOrder);
                    _lastOrder = null;
                    process.exit();
                } else {
                    _lastOrder = order; // update order
                    log.info(_state, _lastOrder.filled_size, "/", _lastOrder.size, "@", _lastOrder.price);

                    if(spot < _lastOrder.price && _lastOrder.price < efficient) {
                        console.log('Should I cancel sell');
                        // gdax.cancelOrder(_lastOrder.id).then(value => {
                        //     if(_lastOrder.filled_size > 0) _sellOrder.size = _sellOrder.size - _lastOrder.filled_size; // update the size to sell
                        //     _state = 'wts'; // 
                        // });
                    } else if(_lastOrder.settled == true) {
                        if(_lastOrder.done_reason == 'canceled') {
                            _state = 'wts';
                        } else if(_lastOrder.done_reason == 'filled') {
                            console.log('sold');
                            process.exit();
                        } else if(_lastOrder.status == 'rejected') {
                            _state = 'wts';
                            log.info('_lastOrder rejected', _lastOrder.reject_reason);
                        } else {
                            log.error('Exited. _lastOrder settled with unknown done_reason:', _lastOrder);
                            process.exit();
                        }
                    }
                }
            });
        }
    }

    this.placeSellOrder = function(gdax, snapshot, efficient) {

        var price = math.max(efficient, _sellOrder.price);
        var ask = _.find(snapshot[_product].asks, (ask) => { return ask.price >= _sellOrder.price });
        if(ask !== undefined) price = ask.price; // set to the higher ask price if available
        
        const sellParams = {
          'product_id': _product,
          'price': price,
          'size': _sellOrder.size,
          'type': 'limit',
          'post_only': true,
        };

        var order = wait.for.promise(gdax.sell(sellParams));
        if(order.status != 'pending') {
            log.warn(order);
        } else {
            _lastOrder = order;
            _state = 'sell'; // prepare to start the next buy-sell pair
            log.info('sell', _lastOrder.size, '@', _lastOrder.price);
        }
    }
};
