require('dotenv').config()
const axios = require('axios')
const https = require('https')
const readChunk = require('read-chunk')
const imageType = require('image-type')
const request = require('request').defaults({ encoding: null })
const sharp = require('sharp')
const FileType = require('file-type')
const gify = require('gify')
const fs = require('fs')
const gifResize = require('@gumlet/gif-resize')
const mongoose = require('mongoose')
const NFTITEM = mongoose.model('NFTITEM')

const generateFileName = () => {
  let fileName = new Date().getTime().toString()
  return fileName
}

const uploadImageToInstance = async (body, extension, nftItem) => {
  let fileName = generateFileName()
  let key = `${fileName}.${extension}`
  try {
    await fs.writeFileSync(`thumb-image/${key}`, body)
    nftItem.thumbnailPath = key
    await nftItem.save()
  } catch (error) {
    console.log(error)
    console.log('upload failed')
  }
}

const resizeBase64Image = async (source, limit = 200) => {
  try {
    if (source.startsWith('data:')) {
      source = source.split(',')[1]
    }
    let image = sharp(Buffer.from(source, 'base64'), { failOnError: false })
    const { format, width, height } = await image.metadata()
    const size = Math.max(width, height)
    let base64
    if (size > limit) {
      image = image.resize(
        Math.floor((width * limit) / size),
        Math.floor((height * limit) / size),
      )
      const buffer = await image.withMetadata().toBuffer()
      base64 = `data:image/${format};base64,` + buffer.toString('base64')
    } else {
      base64 = source
    }

    return Buffer.from(
      base64.indexOf('base64,') >= 0 ? base64.split('base64,')[1] : base64,
      'base64',
    )
  } catch (err) {
    console.log('resize failed')
    return null
  }
}
const resizeImageFromURL = (url) => {
  return new Promise((resolve, reject) => {
    try {
      request.get(url, { timeout: 30000 }, async function (
        error,
        response,
        body,
      ) {
        if (!error && response.statusCode == 200) {
          const base64 =
            'data:' +
            response.headers['content-type'] +
            ';base64,' +
            Buffer.from(body).toString('base64')
          const res = await resizeBase64Image(base64)
          resolve(res)
        }
      })
    } catch (err) {
      console.log('resize from url failed')
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
    console.log('cannot xtract xtension')
    return new Promise(async (resolve, reject) => {
      resolve('non-image')
    })
  }

  return new Promise(async (resolve, reject) => {
    try {
      https.get(imgURL, { timeout: 10000 }, (response) => {
        response.on('readable', () => {
          const chunk = response.read(imageType.minimumBytes)
          response.destroy()
          if (chunk) {
            if (imageType(chunk)) resolve(imageType(chunk).ext)
            else {
              FileType.fromBuffer(chunk)
              .then(result => {
                if ((result.mime || '').split('/')[0] === 'video') {
                  resolve('video')
                } else {
                  resolve('non-image')
                }
              })
              .catch(() => {
                resolve('non-image')
              })
            }
          } else {
            request.get(imgURL, function (err, res, body) {
              if (!body) reject('')
              if (body) {
                if (imageType(body)) {
                  resolve(imageType(body).ext)
                } else {
                  FileType.fromBuffer(body).then(result => {
                    if ((result.mime || '').split('/')[0] === 'video') {
                      resolve('video')
                    } else if ((result.mime || '').split('/')[0] === 'audio') {
                      resolve('audio')
                    } else {
                      resolve('non-image')
                    }
                  })
                  .catch((err) => {
                    resolve('non-image')
                  })
                }
              }
            })
          }
        });
        response.on('error', (err) => {
          response.destroy();
          console.log('promise error', err);
          resolve('non-image');
        });
      })
      .on("timeout", () => {
        console.log('promise timeout');
        resolve('non-image');
      })
      .on("abort", () => {
        console.log('promise aborted');
        resolve('non-image');
      })
    } catch (error) {
      console.log('promise error')
      resolve('non-image')
    }
  })
}

const getThumbnailImageFromURL = async (imgPath) => {
  try {
    let type = await extractExtension(imgPath)
    console.log(type);
    if (type == 'gif') {
      return [1, null]
    }
    else if (type == 'non-image') return [2, null]
    else if (type == 'audio') return [6, null]
    else if (type == 'video') {
      var opts = {
        width: 200
      };
      let fileName = generateFileName()
      let key = `thumb-image/${fileName}.gif`
      try {
        gify(imgPath, key, opts, function(err){
          if (err) throw err;
        });
        return [5, `${fileName}.gif`];
      } catch (error) {
        //
        return [5, 'non-image']
      }
    } else {
      try {
        const buffer = await resizeImageFromURL(imgPath)
        return [3, buffer, type]
      } catch (err) {
        return [4, null]
      }
    }
  } catch (error) {
    console.log('cannot get thumbnail from url')
    try {
      const buffer = await resizeImageFromURL(imgPath)
      let fileType = await FileType.fromBuffer(buffer)
      if (fileType.ext) {
        return [3, buffer, fileType.ext]
      } else {
        return [3, buffer, 'jpg']
      }
    } catch (err) {
      console.log('no file type')
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
    console.log('-------------------------------');
    console.log(tokenURI);
    let timeoutInterval = 2000;
    if (tokenURI && tokenURI.length > 0) {
      try {
        let metadata = await axios.get(tokenURI, { timeout: 30000 })
        let image = metadata.data.image || metadata.data.imageurl
        console.log(image);
        let thumbnailInfo = await getThumbnailImageFromURL(image)
        switch (thumbnailInfo[0]) {
          //case gif
          case 1:
            {
              timeoutInterval = 0;
              request.get(image, async function (err, res, body) {
                if (!body) {
                  console.log('gif image load failed');
                  nftItem.thumbnailPath = '.'
                  nftItem.contentType = 'gif'
                  await nftItem.save()
                  setTimeout(() => {
                    compressNFTImage()
                  }, 500)
                } 
                if (body) {
                  let fileName = generateFileName()
                  let key = `thumb-image/${fileName}.gif`
                  console.log(key);
                  try {
                    const gifRes = await gifResize({
                      width: 200
                    })(body);
                    fs.writeFileSync(key, gifRes);
                    nftItem.thumbnailPath = `${fileName}.gif`
                    nftItem.contentType = 'gif'
                    await nftItem.save()
                    console.log('-----------------------');
                    console.log('gif succeed');
                  } catch (error) {
                    console.log('-----------------------');
                    console.log(error);
                    nftItem.thumbnailPath = '.'
                    nftItem.contentType = 'gif'
                    await nftItem.save()
                  }
                  setTimeout(() => {
                    compressNFTImage()
                  }, 500)
                }
              });
            }
            break
          // non-image case
          case 2:
            {
              nftItem.thumbnailPath = 'non-image'
              await nftItem.save()
            }
            break
          case 5:
            {
              nftItem.thumbnailPath = thumbnailInfo[1]
              nftItem.contentType = 'video'
              timeoutInterval = 10000
              await nftItem.save()
            }
            break
          case 6:
            {
              nftItem.thumbnailPath = 'non-image'
              nftItem.contentType = 'audio'
              await nftItem.save()
            }
            break
          // case image
          case 3:
            {
              nftItem.contentType = 'image'
              await nftItem.save()
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
    if (timeoutInterval > 0) {
      setTimeout(() => {
        compressNFTImage()
      }, timeoutInterval)
    }
  } else {
    setTimeout(() => {
      compressNFTImage()
    }, 500)
  }
}

const compress = async () => {
  compressNFTImage()
}

// const compress = async () => {
//   await NFTITEM.update({thumbnailPath: 'embed'}, { $set: { thumbnailPath: '-', contentType: 'image', isFiltered: false } }, { multi: true })
// }
module.exports = compress
