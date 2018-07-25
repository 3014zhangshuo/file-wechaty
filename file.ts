import * as path from 'path'
import * as qrcodeTerminal  from 'qrcode-terminal'
import { config } from './config'
import { Wechaty, Contact, MediaMessage } from 'wechaty'
//import { DelayQueue } from 'rx-queue'
// wondercv.wechaty.json store session
const bot = Wechaty.instance({profile: 'wondercv'})
const axios = require('axios')
const qiniu = require('qiniu')
//const delay = new DelayQueue(500)

const WONDERCV_PUB_IMAGE_FILE = path.join(
  __dirname,
  './file/wondercv-official-qr-code.jpg',
)

qiniu.conf.ACCESS_KEY = config.qiniu_access_key
qiniu.conf.SECRET_KEY = config.qiniu_secret_key

//delay.subscribe(bot)

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

    if (request.hello) {
        logMsg = 'accepted because verify messsage is "ding"'
        request.accept()
    } else {
        logMsg = 'not auto accepted, because verify message is: ' + request.hello
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
  } else {
    if (!message.self()) {
      if (/电脑/.test(message)) {
        await message.say("超级简历数据云存储，电脑手机可同步编辑！\n\n网址：wondercv.com\n或百度搜索 超级简历")
      } else {
        await message.say("目前仅支持中文简历导入，文件应为 pdf 或 doc 格式，直接发送给我即可上传\n如有其它问题请添加公众号咨询")
        await sleep(2000)
        await message.say(new MediaMessage(WONDERCV_PUB_IMAGE_FILE))
      }
    }
  }
})
.init()
.catch(e => console.error('bot.init() error: ' + e))

async function saveMediaFile(message: MediaMessage) {
  const user = message.from().name()
  const filename = message.filename()
  const timestamp = new Date().getTime()

  console.log(`filename: ${filename}`)

  if ((/(.txt|.doc|.docx|.word|.pdf)$/).test(filename)) {
    try {
      await message.say('正在上传文件… 请稍等')

      const netStream = await message.readyStream()
      const netStream2 = await message.readyStream()
      const filesize = await fileSize(netStream)

      if (filesize >= 2000) {
        return message.say('上传文件过大，请小于2 M')
      }
      console.log(filesize)
      const file_path = `wechaty_upload/${timestamp}/${user}/${filename}`
      const r_qiniu = await uploadToQiniu(netStream2, file_path)

      if (config.debug_mode) {
        await message.say(`qiniu response file path ${r_qiniu}`)
      }
      const re = await axios.post(config.upload_file_url, {path: r_qiniu})
      await sleep(1000)
      await message.say(`点击 ${re.data.path} \n登录并读取简历，电脑手机可同步编辑`)
    } catch (e) {
      message.say(`error:${e}`)
      console.error('stream error:', e)
    }
  } else {
    message.say('文件格式错误，目前仅支持中文简历导入，文件应为 pdf 或 doc 格式，请重新发送')
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

function fileSize(steam) {
  var dataLength = 0
  //var allData = []
  return new Promise(
    function (resolve, reject) {
      steam.on('data', function (chunk) {
        //allData.push(chunk)
        dataLength += chunk.length
      })
      .on('end', function () {
        if (dataLength > 0) {
          resolve(bytesToKB(dataLength))
        } else {
          reject(2000)
        }
      })
    }
  )
}

function bytesToKB(bytes) {
  return Math.round(bytes / 1024, 2)
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
