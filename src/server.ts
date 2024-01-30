import http from 'http'
import WebSocket from 'ws'
import { ActionResponse } from './types'

class TimeLimitError extends Error {
  static is(error: unknown) {
    return error && typeof error === 'object' && error instanceof TimeLimitError
  }
}

export const startServer = () => {
  let action_id = 0
  let activeSocket: WebSocket | null = null
  const pendingRequests = new Map<number, (response: ActionResponse) => void>()

  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200)
      res.end()
      return
    }

    if (req.url === '/favicon.ico') {
      res.writeHead(404)
      res.end()
      return
    }

    if (req.method === 'GET' && req.url) {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`)
      const action = parsedUrl.pathname.slice(1)
      const input = Object.fromEntries(parsedUrl.searchParams)

      action_id++

      const payload = {
        id: action_id,
        action,
        input,
      }

      if (activeSocket) {
        activeSocket.send(JSON.stringify(payload))

        new Promise<ActionResponse>((resolve, reject) => {
          pendingRequests.set(action_id, resolve)
          setTimeout(() => {
            pendingRequests.delete(action_id)
            reject(new TimeLimitError())
          }, 10000)
        })
          .then(response => {
            if (response.error) {
              res.writeHead(500)
              res.end()
              return
            }

            res.writeHead(200, {
              'Content-Type': response.json ? 'application/json' : 'text/plain'
            })
            res.end(response.json ? JSON.stringify(response.content) : String(response.content))
          })
          .catch(error => {
            if (!TimeLimitError.is(error)) {
              console.error(error)
            }
            res.writeHead(500)
            res.end()
          })
      } else {
        console.log('WebSocket is not active ' + req.url)
        res.writeHead(401).end()
      }
    } else {
      res.writeHead(404).end()
    }
  })

  const wss = new WebSocket.Server({ noServer: true })

  wss.on('connection', socket => {
    activeSocket = socket

    socket.on('message', data => {
      const message: ActionResponse = JSON.parse(String(data))
      if (message && message.id && pendingRequests.has(message.id)) {
        const response = pendingRequests.get(message.id)
        pendingRequests.delete(message.id)
        response?.(message)
      }
    })

    socket.on('close', () => {
      if (activeSocket === socket) {
        activeSocket = null
      }
    })

    socket.on('error', error => {
      console.error('WebSocket error: ', error)
      socket.close()
    })
  })

  server.on('upgrade', (request, socket, head) => {
    if (request.headers.upgrade === 'websocket') {
      wss.handleUpgrade(request, socket, head, ws => {
        wss.emit('connection', ws, request)
      })
    } else {
      socket.destroy()
    }
  })

  server.listen(process.env.PORT ?? 8888, () => {
    console.log('Server started!')
  })
}
