/*
Copyright 2019 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

const joi = require('@hapi/joi')

const { AzureStorage } = require('./lib/azure/AzureStorage')
const { StorageError } = require('./lib/StorageError')
const { Storage } = require('./lib/Storage')
const { TvmClient } = require('./lib/TvmClient')

// hardcoded default tvm
// TODO this is a temporary url
const DEFAULT_TVM_API_URL = 'https://adobeioruntime.net/api/v1/web/mraho/adobeio-cna-token-vending-machine-0.1.0'

/**
 * @typedef {import('./lib/azure/AzureStorage').AzureCredentials} AzureCredentials
 */

/**
 * Initializes and returns the storage SDK.
 *
 * To use the SDK you must either provide provide your OpenWhisk credentials in
 * `credentials.ow` or your own cloud storage credentials in `credentials.azure`.
 *
 * OpenWhisk credentials can also be read from environment variables
 *
 * @param {object} credentials used to init the sdk
 *
 * @param {object} [credentials.ow] OpenWhisk credentials, set those if you want
 * to use our storage auto-generated temporary cloud storage credentials from the token
 * vending machine (tvm) for our storage infrastructure
 * @param {string} [credentials.ow.namespace] OpenWhisk namespace, can also be passed
 *   in an environment variable `OW_NAMESPACE` or `__OW_NAMESPACE`
 * @param {string} [credentials.ow.auth] OpenWhisk auth, can also be passed
 *   in an environment variable `OW_AUTH` or `__OW_AUTH`
 *
 * @param {AzureCredentials} [credentials.azure] {@link AzureCredentials}
 *
 * @param {object} [options={}] options
 * @param {string} [options.tvmApiUrl] alternative tvm api url, works only
 * together with credentials.ow
 * @param {string} [options.tvmCacheFile] alternative tvm cache file, works only
 * together with credentials.ow
 * @returns {Promise<Storage>} A storage instance
 * @throws {StorageError}
 */
async function init (credentials, options = {}) {
  // include ow environment vars to credentials
  const namespace = process.env['__OW_NAMESPACE'] || process.env['OW_NAMESPACE']
  const auth = process.env['__OW_AUTH'] || process.env['OW_AUTH']
  if (namespace || auth) {
    if (typeof credentials !== 'object') {
      credentials = {}
    }
    if (typeof credentials.ow !== 'object') {
      credentials.ow = {}
    }
    credentials.ow.namespace = credentials.ow.namespace || namespace
    credentials.ow.auth = credentials.ow.auth || auth
  }

  return _init(credentials, options)
}

// eslint-disable-next-line jsdoc/require-jsdoc
async function _init (credentials, options = {}) {
  const validation = joi.validate(credentials, joi.object().label('credentials').keys({
    azure: joi.object().keys({
      // either
      sasURLPrivate: joi.string().uri(),
      sasURLPublic: joi.string().uri(),
      // or
      storageAccessKey: joi.string(),
      storageAccount: joi.string(),
      containerName: joi.string()
    }).unknown().and('storageAccount', 'storageAccessKey', 'containerName').and('sasURLPrivate', 'sasURLPublic').xor('sasURLPrivate', 'storageAccount'),
    ow: joi.object().keys({
      namespace: joi.string().required(),
      auth: joi.string().required()
    })
  }).unknown().xor('ow', 'azure').required())
  if (validation.error) throw new StorageError(validation.error.message, StorageError.codes.BadArgument)

  // 1. set provider
  const provider = 'azure' // only azure is supported for now

  // 2. get tvm if no credentials
  let tvm
  if (credentials.ow) {
    // default tvm url
    if (!options.tvmApiUrl) options.tvmApiUrl = DEFAULT_TVM_API_URL
    tvm = new TvmClient({ ow: credentials.ow, apiUrl: options.tvmApiUrl, cacheFile: options.tvmCacheFile })
  }

  // 3. return storage based on provider
  switch (provider) {
    case 'azure':
      const azureCreds = credentials.ow ? (await tvm.getAzureBlobCredentials()) : credentials.azure
      return AzureStorage.init(azureCreds)
    default:
      throw new StorageError(`provider '${provider}' is not supported.`, StorageError.codes.BadArgument)
  }
}

module.exports = { init }
