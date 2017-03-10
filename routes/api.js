'use strict';

let users = require('../lib/models/users');
let lists = require('../lib/models/lists');
let campaigns = require('../lib/models/campaigns');
let fields = require('../lib/models/fields');
let subscriptions = require('../lib/models/subscriptions');
let tools = require('../lib/tools');
let express = require('express');
let log = require('npmlog');
let router = new express.Router();

router.all('/*', (req, res, next) => {
    if (!req.query.access_token) {
        res.status(403);
        return res.json({
            error: 'Missing access_token',
            data: []
        });
    }

    users.findByAccessToken(req.query.access_token, (err, user) => {
        if (err) {
            res.status(500);
            return res.json({
                error: err.message || err,
                data: []
            });
        }
        if (!user) {
            res.status(403);
            return res.json({
                error: 'Invalid or expired access_token',
                data: []
            });
        }
        next();
    });

});

// ruby bash
// uri = URI.parse("https://mailtrain.bigamrekr.com/api/lists/create?access_token=202deb301b6d5d141d78d")
// res = Net::HTTP.post_form(uri, {name:'a new from api list name', description: 'new list decription'})
// res.body

// params :{
//     name: 'first list name',
//     description: 'adsfasdf'
// }
router.post('/lists/create', (req, res) => {
  let input = {name: '', description: ''};
  Object.keys(req.body).forEach(key => {
    input[key.toLowerCase()] = req.body[key].toString().trim();
  });
  if(input.name !== '' && input.description !== ''){
    lists.create(req.body, (err, id, cid) => {
      if (err || !id) {
        return res.json({
          result: 'fails',
          message: 'Could not create list'
        });
      }
      return res.json({
        result: 'success',
        id: id,
        cid: cid
      });
    });
  }else{
    return res.json({
      result: 'fails',
      message: 'ensure add list name and description'
    });
  }
});

// params
//   email
//   first_name
//   last_name
//   timezone //subscriber's timezone (eg. "Europe/Tallinn", "PST" or "UTC"). If not set defaults to "UTC"
//   merge_tag_value //custom field value. Use yes/no for option group values (checkboxes, radios, drop downs)

// Additional params:
//   force_subscribe // set to "yes" if you want to make sure the email is marked as subscribed even if it was previously marked as unsubscribed. If the email was already unsubscribed/blocked then subscription status is not changed by default.
//   require_confirmation // set to "yes" if you want to send confirmation email to the subscriber before actually marking as subscribed
router.post('/subscribe/:listId', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim().toUpperCase()] = (req.body[key] || '').toString().trim();
    });
    lists.getByCid(req.params.listId, (err, list) => {
        if (err) {
            log.error('API', err);
            res.status(500);
            return res.json({
                error: err.message || err,
                data: []
            });
        }
        if (!list) {
            res.status(404);
            return res.json({
                error: 'Selected listId not found',
                data: []
            });
        }
        if (!input.EMAIL) {
            res.status(400);
            return res.json({
                error: 'Missing EMAIL',
                data: []
            });
        }
        tools.validateEmail(input.EMAIL, false, err => {
            if (err) {
                log.error('API', err);
                res.status(400);
                return res.json({
                    error: err.message || err,
                    data: []
                });
            }

            let subscription = {
                email: input.EMAIL
            };

            if (input.FIRST_NAME) {
                subscription.first_name = (input.FIRST_NAME || '').toString().trim();
            }

            if (input.LAST_NAME) {
                subscription.last_name = (input.LAST_NAME || '').toString().trim();
            }

            if (input.TIMEZONE) {
                subscription.tz = (input.TIMEZONE || '').toString().trim();
            }

            fields.list(list.id, (err, fieldList) => {
                if (err && !fieldList) {
                    fieldList = [];
                }

                fieldList.forEach(field => {
                    if (input.hasOwnProperty(field.key) && field.column) {
                        subscription[field.column] = input[field.key];
                    } else if (field.options) {
                        for (let i = 0, len = field.options.length; i < len; i++) {
                            if (input.hasOwnProperty(field.options[i].key) && field.options[i].column) {
                                let value = input[field.options[i].key];
                                if (field.options[i].type === 'option') {
                                    value = ['false', 'no', '0', ''].indexOf((value || '').toString().trim().toLowerCase()) >= 0 ? '' : '1';
                                }
                                subscription[field.options[i].column] = value;
                            }
                        }
                    }
                });

                let meta = {
                    partial: true
                };

                if (/^(yes|true|1)$/i.test(input.FORCE_SUBSCRIBE)) {
                    meta.status = 1;
                }

                if (/^(yes|true|1)$/i.test(input.REQUIRE_CONFIRMATION)) {
                    subscriptions.addConfirmation(list, input.EMAIL, req.ip, subscription, (err, cid) => {
                        if (err) {
                            log.error('API', err);
                            res.status(500);
                            return res.json({
                                error: err.message || err,
                                data: []
                            });
                        }
                        res.status(200);
                        res.json({
                            data: {
                                id: cid
                            }
                        });
                    });
                } else {
                    subscriptions.insert(list.id, meta, subscription, (err, response) => {
                        if (err) {
                            log.error('API', err);
                            res.status(500);
                            return res.json({
                                error: err.message || err,
                                data: []
                            });
                        }
                        res.status(200);
                        res.json({
                            data: {
                                id: response.cid
                            }
                        });
                    });
                }
            });
        });
    });
});

router.post('/unsubscribe/:listId', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim().toUpperCase()] = (req.body[key] || '').toString().trim();
    });
    lists.getByCid(req.params.listId, (err, list) => {
        if (err) {
            res.status(500);
            return res.json({
                error: err.message || err,
                data: []
            });
        }
        if (!list) {
            res.status(404);
            return res.json({
                error: 'Selected listId not found',
                data: []
            });
        }
        if (!input.EMAIL) {
            res.status(400);
            return res.json({
                error: 'Missing EMAIL',
                data: []
            });
        }
        subscriptions.unsubscribe(list.id, input.EMAIL, false, (err, subscription) => {
            if (err) {
                res.status(500);
                return res.json({
                    error: err.message || err,
                    data: []
                });
            }
            res.status(200);
            res.json({
                data: {
                    id: subscription.id,
                    unsubscribed: true
                }
            });
        });
    });
});

router.post('/delete/:listId', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim().toUpperCase()] = (req.body[key] || '').toString().trim();
    });
    lists.getByCid(req.params.listId, (err, list) => {
        if (err) {
            res.status(500);
            return res.json({
                error: err.message || err,
                data: []
            });
        }
        if (!list) {
            res.status(404);
            return res.json({
                error: 'Selected listId not found',
                data: []
            });
        }
        if (!input.EMAIL) {
            res.status(400);
            return res.json({
                error: 'Missing EMAIL',
                data: []
            });
        }
        subscriptions.getByEmail(list.id, input.EMAIL, (err, subscription) => {
            if (err) {
                res.status(500);
                return res.json({
                    error: err.message || err,
                    data: []
                });
            }
            if (!subscription) {
                res.status(404);
                return res.json({
                    error: 'Subscription not found',
                    data: []
                });
            }
            subscriptions.delete(list.id, subscription.cid, (err, subscription) => {
                if (err) {
                    res.status(500);
                    return res.json({
                        error: err.message || err,
                        data: []
                    });
                }
                if (!subscription) {
                    res.status(404);
                    return res.json({
                        error: 'Subscription not found',
                        data: []
                    });
                }
                res.status(200);
                res.json({
                    data: {
                        id: subscription.id,
                        deleted: true
                    }
                });
            });
        });
    });
});

router.post('/field/:listId', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim().toUpperCase()] = (req.body[key] || '').toString().trim();
    });
    lists.getByCid(req.params.listId, (err, list) => {
        if (err) {
            log.error('API', err);
            res.status(500);
            return res.json({
                error: err.message || err,
                data: []
            });
        }
        if (!list) {
            res.status(404);
            return res.json({
                error: 'Selected listId not found',
                data: []
            });
        }

        let field = {
            name: (input.NAME || '').toString().trim(),
            defaultValue: (input.DEFAULT || '').toString().trim() || null,
            type: (input.TYPE || '').toString().toLowerCase().trim(),
            group: Number(input.GROUP) || null,
            groupTemplate: (input.GROUP_TEMPLATE || '').toString().toLowerCase().trim(),
            visible: ['false', 'no', '0', ''].indexOf((input.VISIBLE || '').toString().toLowerCase().trim()) < 0
        };

        fields.create(list.id, field, (err, id, tag) => {
            if (err) {
                res.status(500);
                return res.json({
                    error: err.message || err,
                    data: []
                });
            }
            res.status(200);
            res.json({
                data: {
                    id,
                    tag
                }
            });
        });
    });
});

// params
//   name
//   description
//   list // list id
//   template  // template id
//   from
//   address // from address
//   reply-to
//   subject
router.post('/campaigns/create', (req, res) => {
  campaigns.create(req.body, false, (err, id) => {
    if (err || !id) {
      return res.json({result: 'fails', message: err.message});
    }
    return res.json({result: 'success', id: id});
  });
});

// params
//   id
//   delay-hours
//   delay-minutes
// return
//   id: campaigns id

// status: 1 => sucess, 2 => already sending, 3 ==> Bounced, 4 => paused
router.post('/campaigns/send', (req, res) => {
  let delayHours = Math.max(Number(req.body['delay-hours']) || 0, 0);
  let delayMinutes = Math.max(Number(req.body['delay-minutes']) || 0, 0);
  let scheduled = new Date(Date.now() + delayHours * 3600 * 1000 + delayMinutes * 60 * 1000);
  campaigns.send(req.body.id, scheduled, (err, scheduled) => {
    if(err){
      return res.json({result: 'fails', message: 'Email has not been send'});
    }else{
      return res.json({result: 'success', id: req.body.id});
    }
  });
});

module.exports = router;
