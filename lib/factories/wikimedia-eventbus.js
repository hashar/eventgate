'use strict';

const _                      = require('lodash');
const EventInvalidError      = require('../../lib/errors').EventInvalidError;
const defaultEventbus        = require('../../lib/factories/default-eventbus');

/**
 * This module can be used as the value of app.conf.eventbus_init_module.  It exports
 * a function that given app.conf and a logger, returns an instantiated Eventbus instance
 * that will produce to Kafka, and a createEventError function for transforming
 * errors into events that can be produced to an error topic.
 */


/**
 * Returns a new createEventError function that uses conf.error_schema_uri, and conf.error_stream
 * To return an error event that conforms to the event error schema used by Wikimedia.
 *
 * TODO: fully implement this
 * @param {Object} conf
 * @return {function(Object, Object): Object}
 */
function createMapToErrorEvent(conf) {
    return (event, error) => {
        const eventError = {
            '$schema': conf.error_schema_uri,
            meta: {
                topic: conf.error_stream,
                // TODO:
                id: event.meta.id,
                uri: event.meta.uri,
                dt: event.meta.dt,
                domain: event.meta.domain
            },
            emitter_id: 'eventbus',  // TODO: ?
            raw_event: _.isString(event) ? event : JSON.stringify(event)
        };

        if (error instanceof EventInvalidError) {
            eventError.message = error.errorsText;
        } else if (_.isError(error)) {
            eventError.message = error.message;
            eventError.stack = error.stack;
        } else {
            eventError.message = error;
        }

        return eventError;
    };
}

function createFromConf(conf, logger) {
    return defaultEventbus.factory(
        conf,
        logger,
        // Use a custom wikimedia event
        createMapToErrorEvent(conf)
    );
}

// Return a function that instantiates eventbus and createEventError
// based on conf and logger.
module.exports = {
    factory: createFromConf
};