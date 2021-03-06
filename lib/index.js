// Load modules

var Hoek = require('hoek');
var Items = require('items');
var Joi = require('joi');
var Jsonic = require('jsonic');
var Seneca = require('seneca');


// Declare internals

var internals = {
    replies: {},
    handlers: {}
};


exports.register = function (server, options, next) {

    var seneca = Seneca(options);

    server.decorate('server', 'seneca', seneca);
    server.decorate('server', 'action', internals.action(server));

    server.decorate('request', 'seneca', seneca);

    server.decorate('reply', 'act', internals.replies.act);
    server.decorate('reply', 'compose', internals.replies.compose);

    server.handler('act', internals.handlers.act);
    server.handler('compose', internals.handlers.compose);

    // server.dependency('vision');

    return next();
};


exports.register.attributes = {
    pkg: require('../package.json')
};


internals.actionSchema = Joi.object({ cache: Joi.object() });


internals.action = function (server) {

    return function (name, pattern, options) {

        Joi.assert(options, internals.actionSchema, 'Invalid action options');     // Allow only cache option

        if (typeof pattern === 'string') {
            pattern = Jsonic(pattern);
        }

        var method = function (additions, callback) {

            if (typeof additions === 'function') {
                callback = additions;
                additions = null;
            }

            if (additions) {
                pattern = Hoek.applyToDefaults(pattern, typeof additions === 'string' ? Jsonic(additions) : additions);
            }

            return server.seneca.act(pattern, callback);
        };

        if (options &&
            options.cache) {

            var settings = {
                cache: options.cache,
                generateKey: function (additions) {

                    if (!additions) {
                        return '{}';
                    }

                    if (typeof additions === 'string') {
                        additions = Jsonic(additions);
                    }

                    var keys = Object.keys(additions);
                    var result = '';
                    for (var i = 0, il = keys.length; i < il; ++i) {
                        var key = keys[i];
                        var value = additions[key];

                        if (typeof value === 'object') {
                            return null;                                    // Cannot cache complex criteria
                        }

                        if (i) {
                            result += ',';
                        }

                        result += encodeURIComponent(key) + ':' + encodeURIComponent(value.toString());
                    }

                    return result;
                }
            };

            return server.method(name, method, settings);
        }

        return server.method(name, method);
    };
};


internals.replies.act = function (pattern) {

    var self = this;

    this.request.seneca.act(pattern, function (err, result) {

        self.response(err || result);
    });
};


internals.replies.compose = function (template, context, options) {

    var self = this;

    var composed = Hoek.clone(context);
    var actions = internals.collectActions(composed);
    var seneca = this.request.seneca;
    var each = function (action, next) {

        seneca.act(action.pattern, function (err, result) {

            if (err) {
                return next(err);
            }

            action.parent[action.key] = result;
            return next();
        });
    };

    Items.parallel(actions, each, function (err) {

        if (err) {
            return self.response(err);
        }

        return self.view(template, composed, options);
    });
};


internals.collectActions = function (context, results) {

    results = results || [];

    if (context) {
        var keys = Object.keys(context);
        for (var i = 0, il = keys.length; i < il; ++i) {
            var key = keys[i];
            var value = context[key];

            if (key[key.length - 1] === '$') {
                results.push({ parent: context, key: key, pattern: value });
            }
            else if (typeof value === 'object') {
                internals.collectActions(value, results);
            }
        }
    }

    return results;
};


internals.handlers.act = function (route, options) {

    return function (request, reply) {

        var pattern = options;
        if (typeof pattern === 'string') {
            var context = {
                params: request.params,
                query: request.query,
                payload: request.payload
            };

            pattern = Hoek.reachTemplate(context, pattern);
        }

        return reply.act(pattern);
    };
};


internals.composeSchema = Joi.object({
    template: Joi.string().required(),
    context: Joi.object().required(),
    options: Joi.object()
});


internals.handlers.compose = function (route, options) {

    Joi.assert(options, internals.composeSchema, 'Invalid compose handler options (' + route.path + ')');

    return function (request, reply) {

        var context = {
            params: request.params,
            payload: request.payload,
            query: request.query,
            pre: request.pre
        };

        var keys = Object.keys(options.context);
        for (var i = 0, il = keys.length; i < il; ++i) {
            var key = keys[i];
            context[key] = options.context[key];
        }

        return reply.compose(options.template, context, options.options);
    };
};
