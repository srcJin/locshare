// SocketProvider.js
import {useState, createContext, useContext, JSX} from 'react'
import {io, Socket} from 'socket.io-client'
import { SOCKET_URL } from '../config'

// Define the context type for TypeScript to ensure proper use and type checking
type SocketContextType = {
  socket: Socket | null;       // Current active socket instance (or null if not connected)
  connectSocket: () => void;   // Function to connect or re-connect the socket
}

// Props for the provider - receives children components to wrap
type SocketProviderProps = {
  children: JSX.Element
}

// Create a Socket context with default value `null`
// Debug tip: If you see `null` error later, it means `SocketProvider` might not be wrapping the app.
export const SocketContext = createContext<SocketContextType | null>(null)

// The main provider component
export const SocketProvider = ({children}: SocketProviderProps) => {
  const [socket, setSocket] = useState<Socket | null>(null) // Holds the socket connection state

  // Function to connect the socket
  const connectSocket = () => {
    // If no existing socket, establish a new connection
    if(!socket) {
      console.log('Attempting to connect new socket to:', SOCKET_URL)
      const newSocket: Socket = io(SOCKET_URL)

      // Debugging socket connection lifecycle
      newSocket.on('connect', () => {
        console.log('[Socket Connected]:', newSocket.id)
      })

      newSocket.on('disconnect', (reason) => {
        console.warn('[Socket Disconnected]:', reason)
      })

      newSocket.on('connect_error', (error) => {
        console.error('[Socket Connection Error]:', error)
      })

      setSocket(newSocket)
      return
    }

    // If socket already exists, just reconnect (if needed)
    console.log('Socket instance already exists. Attempting to reconnect...')
    socket.connect()
  }

  // Provide the socket and connect function to all child components
  return (
    <SocketContext.Provider value={{socket, connectSocket}}>
      {children}
    </SocketContext.Provider>
  )
}

// Custom hook to easily access the socket context
export const useSocket = () => {
  const context = useContext(SocketContext)
  if(!context) {
    // If hook is called outside of provider
    throw new Error('useSocket must be used within a SocketProvider')
  }
  return context
}
