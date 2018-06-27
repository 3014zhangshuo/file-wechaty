import * as qrcodeTerminal  from 'qrcode-terminal'
import { config } from './config'
import { Wechaty, Contact, MediaMessage } from 'wechaty'

const bot = Wechaty.instance({profile: 'wondercv'})
const axios = require('axios')
const qiniu = require('qiniu')

qiniu.conf.ACCESS_KEY = config.qiniu_access_key
qiniu.conf.SECRET_KEY = config.qiniu_secret_key

bot
.on('scan', (url, code) => {
  if (!/201|200/.test(String(code))) {
    const loginUrl = url.replace(/\/qrcode\//, '/l/')
    qrcodeTerminal.generate(loginUrl)
  }
  console.log(`${url}\n[${code}] Scan QR Code in above url to login: `)
})
.on('login', user => console.log(`${user} logined`))
.on('friend', async (contact, request) => {
  const contactList = await Contact.findAll()
  const friendsCount = contactList.filter(c => !!c.personal()).length

  const fileHelper = Contact.load('filehelper')
  if (friendsCount > 4900) {
    await axios.post(config.notification_url, { amount: friendsCount } )
  }
  let logMsg

  try {
    logMsg = 'received `friend` event from ' + contact.get('name')
    fileHelper.say(logMsg)
    console.log(logMsg)

    if (request && request.hello === 'wondercv') {
      request.accept()
      contact.say('hello')
    }
  } catch (e) {
    logMsg = e.message
    console.log(logMsg)
  }

  fileHelper.say(logMsg)
})
.on('message', async message => {
  console.log(`RECV: ${message}`)

  if (message instanceof MediaMessage) {
    saveMediaFile(message)
  }
})
.init()
.catch(e => console.error('bot.init() error: ' + e))

async function saveMediaFile(message: MediaMessage) {
  const user = message.from().name()
  const filename = message.filename()
  const timestamp = new Date().getTime()

  console.log('local filename: ' + filename)

  if ((/(.txt|.doc|.docx|.word|.pdf)$/).test(filename)) {
    try {
      await message.say('上传文件中..')
      const netStream = await message.readyStream()
      const file_path = `wechaty_upload/${timestamp}/${user}/${filename}`
      const r_qiniu = await uploadToQiniu(netStream, file_path)
      await message.say(`qiniu response file path ${r_qiniu}`)
      const re = await axios.post(config.upload_file_url, {path: r_qiniu})
      await message.say(`点击 ${re.data.path}`)
    } catch (e) {
      message.say(`error:${e}`)
      console.error('stream error:', e)
    }
  } else {
    message.say(`文件：${filename}，格式错误，请确保上传文件格式为【doc|docx|word|pdf】`)
  }
}

function uploadToQiniu(stream, filePath) {
  const mac = new qiniu.auth.digest.Mac(qiniu.conf.ACCESS_KEY, qiniu.conf.SECRET_KEY)
  const options = { scope: config.qiniu_bucket }
  const putPolicy = new qiniu.rs.PutPolicy(options)
  const uploadToken = putPolicy.uploadToken(mac)
  const qiniu_config = new qiniu.conf.Config()
  const formUploader = new qiniu.form_up.FormUploader(qiniu_config)
  const putExtra = new qiniu.form_up.PutExtra()
  return new Promise(function (resolve, reject) {
    formUploader.putStream(uploadToken, filePath, stream, putExtra, function(respErr, respBody, respInfo) {
      if (respErr) {
        throw respErr
      }
      if (respInfo.statusCode === 200) {
        console.log(respBody)
        resolve(respBody.key)
      } else {
        console.log(respInfo.statusCode)
        console.log(respBody)
        reject(respInfo.statusCode)
      }
    })
  })
}
