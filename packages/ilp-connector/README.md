# Five Bells Connector [![npm][npm-image]][npm-url] [![circle][circle-image]][circle-url] [![coveralls][coveralls-image]][coveralls-url]

[npm-image]: https://img.shields.io/npm/v/five-bells-connector.svg?style=flat
[npm-url]: https://npmjs.org/package/five-bells-connector
[circle-image]: https://circleci.com/gh/interledger/five-bells-connector.svg?style=shield
[circle-url]: https://circleci.com/gh/interledger/five-bells-connector
[coveralls-image]: https://coveralls.io/repos/interledger/five-bells-connector/badge.svg?branch=master
[coveralls-url]: https://coveralls.io/r/interledger/five-bells-connector?branch=master

> A reference implementation of the Five Bells Connector API

## Usage

You can see the connector in action as part of the [`five-bells-demo`](https://github.com/interledger/five-bells-demo)!

To run the connector as a standalone server, follow these directions.

Note: You need two [`five-bells-ledger`](https://github.com/interledger/five-bells-ledger) instances to trade between.

### Step 1: Clone repo

``` sh
git clone https://github.com/interledger/five-bells-connector.git

cd five-bells-connector
```
### Step 2: Install dependencies

``` sh
npm install
```

### Step 3: Run it!

``` sh
npm start
```

### Configuration

#### General

* `CONNECTOR_BIND_IP` (default: `0.0.0.0`) IP that Five Bells Connector will bind to.
* `CONNECTOR_PORT` (default: `4000`) Port that Five Bells Connector will listen on.
* `CONNECTOR_HOSTNAME` (default: *[your hostname]*) Publicly visible hostname. This is important for things like generating globally unique IDs. Make sure this is a hostname that all your clients will be able to see. The default should be fine for local testing.
* `CONNECTOR_PUBLIC_PORT` (default: `$PORT`) Publicly visible port. You can set this if your public port differs from the listening port, e.g. because the connector is running behind a proxy.
* `CONNECTOR_PUBLIC_HTTPS` (default: `''`) Whether or not the publicly visible instance of Five Bells Connector is using HTTPS.

#### Trading

* `CONNECTOR_LEDGERS` (default: `[]`) Ledgers where this connector has accounts. Used to auto-generate `CONNECTOR_PAIRS`.
```js
[
  "USD@http://usd-ledger.example",
  "EUR@http://eur-ledger.example"
]
```
* `CONNECTOR_CREDENTIALS` (default: `{}`) Connector's login credentials for various ledgers, ex.
```js
{
  "<ledger_uri>": {
    "account_uri": "...",
    "username": "...",
    "password": "..."
  }
}
```
* `CONNECTOR_PAIRS` (default: *[all possible combinations]*) Pairs to trade on, ex.
```js
[
  [
    'USD@http://ledger1.example',
    'EUR@http://ledger2.example'
  ],[
    'EUR@http://ledger2.example',
    'USD@http://ledger1.example'
  ]
]
```
* `CONNECTOR_FX_SPREAD` (default: `0.002` =.2%) How much of a spread to add on top of the reference exchange rate. This determines the connector's margin.
* `CONNECTOR_MIN_MESSAGE_WINDOW` (default: `1`) Minimum time the connector wants to budget for getting a message to the ledgers its trading on. In seconds.
* `CONNECTOR_MAX_HOLD_TIME` (default: `10`) Maximum duration the connector is willing to place funds on hold while waiting for the outcome of a transaction. In seconds.

#### Auto-funding

The connector can automatically create and fund accounts when it has admin credentials for all ledgers it is trading on. This is used for testing and demos.

* `CONNECTOR_DEBUG_AUTOFUND` (default: `''`) Debug feature which uses corresponding ledger debug.
* `CONNECTOR_ADMIN_USER` (default: `admin`) Admin user name on the connected ledgers.
* `CONNECTOR_ADMIN_PASS` (required if `CONNECTOR_DEBUG_AUTOFUND` is set) Password of the ledger's admin user.

## Running with Docker

This project can be run in a [Docker](https://www.docker.com/) container.


``` sh
docker run -it --rm -e CONNECTOR_PORT=4000 interledger/five-bells-connector
```

Breaking down that command:

* `-it` Run Five Bells Connector in an interactive terminal.
* `--rm` Delete container when it's done running.
* `-e CONNECTOR_PORT=4000` Set the connector's port to 4000. This is just an example for how to set a config option.
