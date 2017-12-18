var _ = require('lodash');
var math = require('mathjs');
var wait = require('wait-for-stuff');
var log = require('loglevel');



//const sandboxURI = 'https://api-public.sandbox.gdax.com';

module.exports = function(gdax, product, baseAmount) {

	var self = this;
	var product = product;
	var state = null;
	var lastOrder = null;
	var baseCurrency = product.split('-');
	var quoteCurrency = baseCurrency[1];
	baseCurrency = baseCurrency[0];
	var accounts = wait.for.promise(gdax.getAccounts());
	log.debug(accounts[baseCurrency].available, accounts[quoteCurrency].available);

    this.getState = function() { return state; }

	this.play = function(gdax, snapshot, spot, efficient) {

		if((state == null || state == 'wts') && spot > efficient && accounts[baseCurrency].available > 0.00001)
		{
			this.placeSellOrder(gdax, snapshot, product)
		}
		else if((state == null || state == 'wtb')  && spot < efficient  && accounts[quoteCurrency].available > 0.00001)
		{
			this.placeBuyOrder(gdax, snapshot, product);
		}
		else if(state == 'buy')
		{
			this._trading(gdax, 'buy', 'wtb', 'wts', spot <= lastOrder.price, spot > efficient);
		}
		else if(state == 'sell')
		{
			this._trading(gdax, 'sell', 'wts', 'wtb', spot >= lastOrder.price, spot < efficient);
		}
	}

	this._trading = function(gdax, state, stateCancelled, stateDone, checkOrder, cancelOrder) {

        log.debug(state, lastOrder.price, spot);

        if(checkOrder)
        {
            // check order whether filled
            gdax.getOrder(lastOrder.id).then(order => {
                lastOrder = order;
                if(lastOrder.settled == true)
                {
                    gdax.getAccounts();
                    
                    if(lastOrder.done_reason == 'canceled') {
                        log.info('cancelled buy', lastOrder.size, '@', lastOrder.price);
                        state = stateCancelled;
                    } else if(lastOrder.done_reason == 'filled') {
                        log.info('bought', lastOrder.size, '@', lastOrder.price);
                        state = stateDone;
                    } else {
                        log.debug(lastOrder);
                        log.info('LastOrder done_reason', lastOrder.done_reason);
                        process.exit();
                    }
                }
            });
        }

        if(cancelOrder)
        {
            if(Number(lastOrder.filled_size) > 0) 
            {
                // cancel if only not started filling
                log.info('filling order, cannot cancel');
            }
            else
            {
                gdax.cancelOrder(lastOrder.id).then(value => {
                    lastOrder = null;
                    log.info('cancel', state);
                    state = stateCancelled;
                });
            }
        }
    }

	this.placeBuyOrder = function(gdax, snapshot, product) {
		let size = parseInt(accounts[quoteCurrency].available / snapshot[product].bids[0].price * 1000000) / 1000000;
		const buyParams = {
		  'product_id': product,
		  'price': snapshot[product].bids[0].price,
		  'size': size,
		  'type': 'limit',
		  'post_only': true,
		};

		lastOrder = wait.for.promise(gdax.buy(buyParams));
		state = 'sell';
		log.debug(lastOrder);
		log.info(state, lastOrder.size, '@', lastOrder.price);
	}

	this.placeSellOrder = function(gdax, snapshot, product) {
		const sellParams = {
		  'product_id': product,
		  'price': snapshot[product].asks[0].price,
		  'size': accounts[baseCurrency].available,
		  'type': 'limit',
		  'post_only': true,
		};

		lastOrder = wait.for.promise(gdax.sell(snapshot, product));
		state = 'buy';
		log.debug(lastOrder);
		log.info(state, lastOrder.size, '@', lastOrder.price);
	}

}
