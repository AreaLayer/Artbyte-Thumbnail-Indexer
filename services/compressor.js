require('dotenv').config()
const AWS = require('aws-sdk')
const axios = require('axios')
const https = require('https')
const imageType = require('image-type')
const request = require('request').defaults({ encoding: null })
const sharp = require('sharp')
const FileType = require('file-type')
const fs = require('fs')
const mongoose = require('mongoose')
const NFTITEM = mongoose.model('NFTITEM')

const spacesEndpoint = new AWS.Endpoint('sfo3.digitaloceanspaces.com')
const artionBucket = 'artionstorage'
// configure S3
const s3 = new AWS.S3({
  endpoint: spacesEndpoint,
  accessKeyId: process.env.SPACES_KEY,
  secretAccessKey: process.env.SPACES_SECRET,
})

const generateFileName = () => {
  let fileName = new Date().getTime().toString()
  return fileName
}
/* Digital Ocean, AWS S3 compatible Bucket related Functions */

// create a S3 bucket
// const createBucket = async (bucketName) => {
//   let params = {
//     Bucket: bucketName,
//   }
//   s3.createBucket(params, function (err, data) {
//     if (err) console.log(err, err.stack)
//     else console.log(data)
//   })
// }

// upload a file to S3 bucket and returns the public URL

const uploadImageToInstance = async (body, extension, nftItem) => {
  let fileName = generateFileName()
  let key = `${fileName}.${extension}`
  try {
    const res = await fs.writeFileSync(`thumb-image/${key}`, body);
    nftItem.thumbnailPath = `https://storage.artion.io/image/${key}`
    await nftItem.save()
  } catch (error) {
    //
    console.log('---------ERROR-------')
    console.log(key)
    console.log(error)
    console.log(body)
  }
  // let params = {
  //   Bucket: artionBucket,
  //   Key: key,
  //   Body: body,
  //   ACL: 'public-read',
  //   Metadata: {
  //     'Content-Type': `image/${extension}`,
  //   },
  // }
  // s3.putObject(params, async (err, data) => {
  //   if (err) {
  //     console.log(err, err.stack)
  //   } else {
  //   }
  // })
}

const resizeBase64Image = async (source, limit = 120) => {
  try {
    if (source.startsWith('data:image')) {
      source = source.split(',')[1]
    }
    let image = sharp(Buffer.from(source, 'base64'))
    const { format, width, height } = await image.metadata()
    const size = Math.max(width, height)
    let base64
    if (size > limit) {
      image = image.resize(
        Math.floor((width * limit) / size),
        Math.floor((height * limit) / size),
      )
      const buffer = await image.toBuffer()
      base64 = `data:image/${format};base64,` + buffer.toString('base64')
    } else {
      base64 = source
    }
    return Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ''), 'base64')
  } catch (err) {
    return null
  }
}
const resizeImageFromURL = (url) => {
  return new Promise((resolve, reject) => {
    try {
      console.log(url)
      request.get(url, async function (error, response, body) {
        if (!error && response.statusCode == 200) {
          const base64 =
            'data:' +
            response.headers['content-type'] +
            ';base64,' +
            Buffer.from(body).toString('base64')
          console.log(base64);
          const res = await resizeBase64Image(base64)
          resolve(res)
        }
      })
    } catch (err) {
      console.log('--encoding error-------------------')
      console.log(err)
      reject(err)
    }
  })
}

const extractExtension = async (imgURL) => {
  try {
    if (!imgURL.startsWith('https')) {
      return new Promise(async (resolve, reject) => {
        resolve('non-image')
      })
    }
  } catch (error) {
    return new Promise(async (resolve, reject) => {
      resolve('non-image')
    })
  }

  return new Promise(async (resolve, reject) => {
    try {
      https.get(imgURL, (response) => {
        response.on('readable', () => {
          const chunk = response.read(imageType.minimumBytes)
          response.destroy()
          if (chunk) {
            if (imageType(chunk)) resolve(imageType(chunk).ext)
            else resolve('non-image')
          } else {
            request.get(imgURL, function (err, res, body) {
              if (!body) reject('')
              if (body && imageType(body)) {
                resolve(imageType(body).ext)
              } else resolve('non-image')
            })
          }
        })
      })
    } catch (error) {
      resolve('non-image')
    }
  })
}

const getThumbnailImageFromURL = async (imgPath) => {
  try {
    let type = await extractExtension(imgPath)
    if (type == 'gif') return [1, null]
    else if (type == 'non-image') return [2, null]
    else {
      try {
        console.log(1)
        const buffer = await resizeImageFromURL(imgPath)
        return [3, buffer, type]
      } catch (err) {
        return [4, null]
      }
    }
  } catch (error) {
    try {
      console.log(2)
      const buffer = await resizeImageFromURL(imgPath)
      let fileType = await FileType.fromBuffer(buffer)
      if (fileType.ext) {
        return [3, buffer, fileType.ext]
      } else {
        return [3, buffer, 'jpg']
      }
    } catch (err) {
      return [4, null]
    }
  }
}

const compressNFTImage = async () => {
  let nftItem = await NFTITEM.findOne({
    thumbnailPath: '-',
  })
  if (nftItem) {
    let tokenURI = nftItem.tokenURI
    if (tokenURI) {
      try {
        let metadata = await axios.get(tokenURI)
        let image = metadata.data.image
        let thumbnailInfo = await getThumbnailImageFromURL(image)
        console.log(thumbnailInfo)
        switch (thumbnailInfo[0]) {
          //case gif
          case 1:
            {
              nftItem.thumbnailPath = image
              await nftItem.save()
            }
            break
          // non-image case
          case 2:
            {
              nftItem.thumbnailPath = 'non-image'
              await nftItem.save()
            }
            break
          // case image
          case 3:
            {
              await uploadImageToInstance(
                thumbnailInfo[1],
                thumbnailInfo[2],
                nftItem,
              )
            }
            break
          case 4:
            {
              nftItem.thumbnailPath = '.'
              await nftItem.save()
            }
            break
          default: {
            nftItem.thumbnailPath = '.'
            await nftItem.save()
          }
        }
      } catch (error) {
        nftItem.thumbnailPath = '.'
        await nftItem.save()
      }
    } else {
      nftItem.thumbnailPath = '.'
      await nftItem.save()
    }
    compressNFTImage();
  } else {
    setTimeout(() => {
      compressNFTImage();
    }, 1000);
  }
}

const compress = async () => {
  // setInterval(async () => {
    compressNFTImage()
  // }, 1000)
}

// const compress = async () => {
//   await NFTITEM.update({}, { $set: { thumbnailPath: '-' } }, { multi: true })
// }
module.exports = compress
