/*
 * Copyright 2017 balena
 *
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

const assignIn = require('lodash/assignIn');
const mapValues = require('lodash/mapValues');

const Bluebird = require('bluebird');
const config = require('config');
const imagefs = require('resin-image-fs');
const path = require('path');
const fs = Bluebird.promisifyAll(require('fs'));
const { join } = require('path');
const pipeline = Bluebird.promisify(require('stream').pipeline);
const unzip = require('unzip');
const zlib = require('zlib');

// TODO: This function should be implemented using Reconfix
const injectBalenaConfiguration = (image, configuration) => {
	return imagefs.writeFile(
		{
			image,
			partition: 1,
			path: '/config.json',
		},
		JSON.stringify(configuration),
	);
};

// TODO: This function should be implemented using Reconfix
const injectNetworkConfiguration = async (image, configuration) => {
	if (configuration.wireless == null) {
		return;
	}
	if (configuration.wireless.ssid == null) {
		throw new Error(
			`Invalide wireless configuration: ${configuration.wireless}`,
		);
	}

	const wifiConfiguration = [
		'[connection]',
		'id=balena-wifi',
		'type=wifi',
		'[wifi]',
		'hidden=true',
		'mode=infrastructure',
		`ssid=${configuration.wireless.ssid}`,
		'[ipv4]',
		'method=auto',
		'[ipv6]',
		'addr-gen-mode=stable-privacy',
		'method=auto',
	];

	if (configuration.wireless.psk) {
		Reflect.apply(wifiConfiguration.push, wifiConfiguration, [
			'[wifi-security]',
			'auth-alg=open',
			'key-mgmt=wpa-psk',
			`psk=${configuration.wireless.psk}`,
		]);
	}

	await imagefs.writeFile(
		{
			image,
			partition: 1,
			path: '/system-connections/balena-wifi',
		},
		wifiConfiguration.join('\n'),
	);
};

module.exports = class BalenaOS {
	constructor(options = {}) {
		this.deviceType = options.deviceType;
		this.network = options.network;
		this.image = { path: config.get('leviathan.uploads.image') };
		this.configJson = options.configJson || {};
		this.contract = {
			network: mapValues(this.network, value => {
				return typeof value === 'boolean' ? value : true;
			}),
		};
	}

	unpack(download) {
		const types = {
			jenkins: async () => {
				await pipeline(
					fs.createReadStream(path.join(download.source, 'resin.img.zip')),
					unzip.Parse(),
				);

				const version = await fs.readFileAsync(
					path.join(download.source, 'VERSION_HOSTOS'),
				);

				return {
					version,
				};
			},
			local: async () => {
				await pipeline(
					fs.createReadStream(download.source),
					zlib.createGunzip(),
					fs.createWriteStream(this.image.path),
				);

				const version = /VERSION="(.*)"/g.exec(
					await imagefs.readFile({
						image: this.image.path,
						partition: 1,
						path: '/os-release',
					}),
				);
				const variant = /VARIANT_ID="(.*)"/g.exec(
					await imagefs.readFile({
						image: this.image.path,
						partition: 1,
						path: '/os-release',
					}),
				);

				if (!version) {
					throw new Error('Could not find OS version on the image.');
				}

				return {
					version: version != null ? version[1] : null,
					variant: variant != null ? variant[1] : null,
				};
			},
		};

		return types[download.type]();
	}

	async fetch(
		download,
		logger = { log: console.log, status: console.log, info: console.log },
	) {
		logger.log('Unpacking the operating system');
		assignIn(
			this.contract,
			await this.unpack({
				type: download.type,
				source: join(config.get('leviathan.workdir'), 'image'),
			}),
		);
	}

	addCloudConfig(configJson) {
		assignIn(this.configJson, configJson);
	}

	async configure(
		logger = { log: console.log, status: console.log, info: console.log },
	) {
		logger.log(`Configuring balenaOS image: ${this.image.path}`);
		if (this.configJson) {
			await injectBalenaConfiguration(this.image.path, this.configJson);
		}
		await injectNetworkConfiguration(this.image.path, this.network);
	}
};
