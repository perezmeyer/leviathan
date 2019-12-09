/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const { delay } = require('bluebird');
const request = require('request-promise');

const SUPERVISOR_PORT = 48484;
const BRIGTHNESS_STEP = [255, 0];
const BLINKS = 19;
const BLINK_DURATION = 20000;

module.exports = {
	title: 'Identification test',
	os: {
		type: 'string',
		required: ['variant'],
		const: 'development',
	},
	run: async function(test) {
		const serviceName = 'collector';
		const ip = await this.context.get().worker.ip(this.context.get().link);
		console.log(ip);

		// Wait for the supervisor API to be up
		await this.context.get().utils.waitUntil(async () => {
			return (
				(await request({
					method: 'GET',
					uri: `http://${ip}:${SUPERVISOR_PORT}/ping`,
				})) === 'OK'
			);
		}, false);
		console.log('done');

		await this.context
			.get()
			.worker.executeCommandInHostOS(
				`source /etc/resin-supervisor/supervisor.conf ; systemd-run --unit=${serviceName} bash -c "while true ; do cat $LED_FILE ; done"`,
				this.context.get().link,
			);
		console.log('here');

		const body = await request({
			method: 'POST',
			uri: `http://${ip}:${SUPERVISOR_PORT}/v1/blink`,
		});

		test.is(body, 'OK', 'Response should be expected');

		// Wait for the blink action to complete
		await delay(BLINK_DURATION);

		await this.context
			.get()
			.worker.executeCommandInHostOS(
				`systemctl stop ${serviceName}`,
				this.context.get().link,
			);

		const lines = (
			await this.context
				.get()
				.worker.executeCommandInHostOS(
					`journalctl -o cat --unit=${serviceName}`,
					this.context.get().link,
				)
		).split('\n');

		const extractedLines = lines.slice(
			lines.findIndex(line => {
				return /^Started.*/.test(line);
			}) + 1,
			lines.findIndex(line => {
				return /^Stopping.*/.test(line);
			}),
		);

		// we want to collapse only duplciated values from our read
		const result = extractedLines.reduce((acc, line) => {
			return acc.slice(-1)[0] != parseInt(line)
				? acc.concat([parseInt(line)])
				: acc;
		}, []);

		test.true(
			result.length > 0 && result.length % 2 == 0,
			'Blink pattern should have been detected',
		);

		let count = 0;
		for (let i = 0; i < result.length; i += 2) {
			if (
				result[i] == BRIGTHNESS_STEP[0] &&
				result[i + 1] == BRIGTHNESS_STEP[1]
			) {
				++count;
			}
		}
		test.is(count, BLINKS, `Led should have blinked ${BLINKS}x`);
	},
};
