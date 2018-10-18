'use strict';

const sUtil = require('../lib/util');

const _        = require('lodash');
const wikimedia = require('../lib/wikimedia');

/**
 * The main router object
 */
const router = sUtil.router();

/**
 * The main application object reported when this module is require()d
 */
let app;

module.exports = function(appObj) {

    app = appObj;

    /**
     * A new function that converts errors and events into
     * event error objects suitable for reproducing to a configured
     * error topic.
     */
    const createEventError =
        app.conf.error_stream ? wikimedia.createEventErrorFunction(app.conf) : undefined;

    // Create the eventbus instance with a connected Producer.
    wikimedia.createEventBus(app.logger._logger, app.conf)
    .then((eventbus) => {

        // Now that everything is ready, we can accept events at this route.
        router.post('/events', (req, res) => {

            // If empty body, return 400 now.
            if (_.isEmpty(req.body)) {
                res.statusMessage = 'Must provide JSON encoded events in request body.';
                req.logger.log('warn/events', res.statusMessage);
                res.status(400);
                res.end();
                return;
            }

            // Make sure events is an array, even if we were given only one event.
            const events = _.isArray(req.body) ? req.body : [req.body];

            // TODO: bikeshed this query param name.
            // If the requester wants a hasty response, return now!
            if (req.query.hasty) {
                res.statusMessage = `${events.length} events hastily received.`;
                req.logger.log('debug/events', res.statusMessage);
                res.status(204);
                res.end();
            }

            // Process events (validate and produce)
            return eventbus.process(events)
            .then((results) => {

                const successCount = results.success.length;
                const invalidCount = results.invalid.length;
                const errorCount = results.error.length;
                const failureCount = results.invalid.length + results.error.length;

                if (failureCount === 0) {
                    // No failures, all events produced successfully: 204
                    const statusMessage =
                        `All ${successCount} out of ${events.length} events were accepted.`;
                    req.logger.log('debug/events', statusMessage);

                    // Only set response if it hasn't yet finished,
                    // i.e. hasty response was not requested.
                    if (!res.finished) {
                        res.statusMessage = statusMessage;
                        res.status(204);
                        res.end();
                    }
                } else if (invalidCount === events.length) {
                    // All events were invalid: 400
                    const statusMessage = `${invalidCount} out of ${events.length} ` +
                        `events were invalid and not accepted.`;
                    req.logger.log(
                        'warn/events',
                        { invalid: results.invalid, message: statusMessage }
                    );

                    if (!res.finished) {
                        res.statusMessage = statusMessage;
                        res.status(400);
                        res.json({ invalid: results.invalid });
                    }
                } else if (failureCount !== events.length) {
                    // Some successes, but also some failures (invalid or errored): 207
                    const statusMessage = `${results.success.length} out of ${events.length} ` +
                        `events were accepted, but ${failureCount} failed (${invalidCount} ` +
                        `invalid and ${errorCount} errored).`;

                    req.logger.log(
                        'warn/events',
                        { error: results.error, invalid: results.invalid, message: statusMessage }
                    );

                    if (!res.finished) {
                        res.statusMessage = statusMessage;
                        res.status(207);
                        res.json({ invalid: results.invalid, error: results.error });
                    }
                } else {
                    // All events had some failure eith at least one error
                    // (some might have been invalid): 500
                    const statusMessage = `${failureCount} out of ${events.length} ` +
                        `events had failures and were not accepted. (${invalidCount} ` +
                        `invalid and ${errorCount} errored).`;
                    req.logger.log(
                        'error/events',
                        { errors: results.error, message: statusMessage }
                    );

                    if (!res.finished) {
                        res.statusMessage = statusMessage;
                        res.status(500);
                        res.json({ invalid: results.invalid, error: results.error });
                    }
                }

                return results;
            })
            // finally convert any failed events to error events and produce them
            // to the error topic (if given).
            // TODO: if we encounter Kafka errors...what then?
            .then((results) => {
                const failedResults = results.invalid.concat(results.error);
                if (createEventError && !_.isEmpty(failedResults)) {
                    req.logger.log(
                        'info/events',
                        `Producing ${failedResults.length} failed events to topic ` +
                        `${app.conf.error_stream}`
                    );

                    const eventErrors = _.map(failedResults, (failedResult) => {
                        console.log("FAILED R", failedResult);
                        return createEventError(
                            // context will be the error that caused the failure.
                            failedResult.context,
                            failedResult.event
                        );
                    });
                    console.log('PRODUINT ', eventErrors);
                    return eventbus.process(eventErrors);
                } else {
                    return results;
                }
            });
        });
    });


    // the returned object mounts the routes on
    // /{domain}/vX/mount/path
    return {
        path: '/v1',
        api_version: 1,  // must be a number!
        router,
        skip_domain: true
    };

};