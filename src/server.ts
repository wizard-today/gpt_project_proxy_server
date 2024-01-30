import http from 'http'
import WebSocket from 'ws'
import { ActionResponse } from './types'

class TimeLimitError extends Error {
  static is(error: unknown) {
    return error && typeof error === 'object' && error instanceof TimeLimitError
  }
}

const parseJsonBody = (req: http.IncomingMessage): Promise<string> => {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk.toString()
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch (error) {
        reject(error)
      }
    })
  })
}

export const startServer = () => {
  return new Promise<http.Server>(resolve => {
    let action_id = 0
    let activeSocket: WebSocket | null = null
    const pendingRequests = new Map<number, (response: ActionResponse) => void>()

    const waitingForWebSocketResponse = () => new Promise<ActionResponse>((resolve, reject) => {
      pendingRequests.set(action_id, resolve)
      setTimeout(() => {
        pendingRequests.delete(action_id)
        reject(new TimeLimitError())
      }, 10000)
    })

    const server = http.createServer(async (req, res) => {
      try {
        if (req.url === '/') {
          return res.writeHead(200).end()
        }

        if (!req.url || req.url === '/favicon.ico') {
          return res.writeHead(404).end()
        }

        const url = new URL(req.url, `http://${req.headers.host}`)

        const payload = {
          id: ++action_id,
          action: url.pathname.slice(1),
          input: (
            req.method === 'GET'
              ? Object.fromEntries(url.searchParams)
              : await parseJsonBody(req)
          ),
        }

        if (!activeSocket) {
          return res.writeHead(401).end()
        }

        activeSocket.send(JSON.stringify(payload))

        const response = await waitingForWebSocketResponse()

        if (response.error) {
          return res.writeHead(500).end()
        }

        // send action response
        return res.writeHead(200, {
          'Content-Type': (
            response.json
              ? 'application/json'
              : 'text/plain'
          )
        }).end(
          response.json
            ? JSON.stringify(response.content)
            : String(response.content)
        )
      }
      catch (error) {
        if (!TimeLimitError.is(error)) {
          console.error(error)
        }
        return res.writeHead(500).end()
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

    server.listen(process.env.PORT ?? 80, () => resolve(server))
  })
}
