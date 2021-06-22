require('dotenv').config()
const mongoose = require('mongoose')

require('./models/nftitems')

const compress = require('./services/compressor')

const uri = process.env.DB_URL

mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })
const db = mongoose.connection
db.on('error', console.error.bind(console, 'connection error:'))
db.once('open', async () => {
  console.log('artion image compressor has been connected to the db server')
  compress()
})
