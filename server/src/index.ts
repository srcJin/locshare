// server/src/index.ts

import express, { Express, Request, Response } from "express";
import { Socket, Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

import fs from "fs";

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 5888;

app.use(cors());
app.use(express.json());

app.get("/", (req: Request, res: Response) => {
  res.send("Welcome to Evacuate Server!");
});

// Initialize Supabase client using environment variables
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const server = app.listen(port, () => {
  console.log(`Server is running`);
});

const io: Server = new Server(server, {
  cors: {
    origin: "*",
  },
});

// Define a custom interface extending the Socket interface
interface CustomSocket extends Socket {
  roomId?: string;
  nickname?: string;
}

const roomCreator = new Map<string, string>(); // roomid => socketid

// This object will store the history for each room:
let locationHistory: Record<string, any[]> = {};

io.on("connection", (socket: CustomSocket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("createRoom", async (data) => {
    const roomId = Math.random().toString(36).substring(2, 7);
    socket.join(roomId);

    // Save the nickname provided from the client (fallback to socket.id)
    socket.nickname = data.nickname || socket.id;

    const totalRoomUsers = io.sockets.adapter.rooms.get(roomId);

    // Initialize history for the room
    locationHistory[roomId] = [];

    // Record initial location if provided
    if (data.position) {
      const initialUpdate = {
        room_id: roomId,
        user_id: socket.id,
        nickname: socket.nickname,
        position: data.position,
        timestamp: new Date().toISOString(),
      };

      // Append the initial update to the room's history
      locationHistory[roomId].push(initialUpdate);

      // Write the updated history to a JSON file (async)
      fs.writeFile(
        "location_history.json",
        JSON.stringify(locationHistory, null, 2),
        (err) => {
          if (err) {
            console.error("Error writing location history:", err);
          }
        }
      );

      // Insert the initial record into the Supabase database
      const { data: supabaseData, error } = await supabase
        .from("url_evacuation_location_history")
        .insert([initialUpdate]);

      if (error) {
        console.error("Error inserting initial location update:", error);
      } else {
        console.debug(
          "[createRoom] Successfully inserted initial location update:");
      }
    }

    // Emit the room creation event back to the client
    socket.emit("roomCreated", {
      roomId,
      position: data.position,
      totalConnectedUsers: Array.from(totalRoomUsers || []),
      nickname: socket.nickname,
    });
    roomCreator.set(roomId, socket.id);
    socket.roomId = roomId; // attach roomId to socket
  });

  socket.on("joinRoom", (data: { roomId: string; nickname?: string }) => {
    // check if room exists
    const roomExists = io.sockets.adapter.rooms.has(data.roomId);
    if (roomExists) {
      socket.join(data.roomId);
      socket.roomId = data.roomId; //  attach roomId to socket
      socket.nickname = data.nickname || socket.id;

      // Notify the room creator about the new user
      const creatorSocketID = roomCreator.get(data.roomId);
      if (creatorSocketID) {
        const creatorSocket = io.sockets.sockets.get(creatorSocketID); // get socket instance of creator
        if (creatorSocket) {
          const totalRoomUsers = io.sockets.adapter.rooms.get(data.roomId);
          creatorSocket.emit("userJoinedRoom", {
            userId: socket.id,
            nickname: socket.nickname,
            totalConnectedUsers: Array.from(totalRoomUsers || []),
          });
        }
      }
      // msg to joiner
      io.to(`${socket.id}`).emit("roomJoined", {
        status: "OK",
        nickname: socket.nickname,
      });
    } else {
      io.to(`${socket.id}`).emit("roomJoined", {
        status: "ERROR",
      });
    }
  });

  // socket.on('updateLocation', (data) => {
  //   io.emit('updateLocationResponse', data)
  // })

  // Record Every Location Update and Write to File
  socket.on("updateLocation", async (data) => {
    const roomId = socket.roomId;
    if (roomId) {
      console.debug("[updateLocation] Received data:", data, "for roomId:", roomId);

      // Create an update record with a timestamp
      const update = {
        room_id: roomId,
        user_id: socket.id,
        nickname: socket.nickname,
        position: data.position,
        timestamp: new Date().toISOString(),
      };
      // Append the update to the room's history
      locationHistory[roomId].push(update);

      // Write the whole history object to a JSON file (async)
      fs.writeFile(
        "location_history.json",
        JSON.stringify(locationHistory, null, 2),
        (err) => {
          if (err) console.error("Error writing location history:", err);
        }
      );

      // // Insert the record into the Supabase database
      // const { error } = await supabase
      //   // define the table name
      //   .from('url_evacuation_location_history')
      //   .insert([update])

      // if (error) {
      //   console.error("Error inserting location update:", error)
      // }

      // Insert the record into the Supabase database
      const { data: supabaseData, error } = await supabase
        .from("url_evacuation_location_history")
        .insert([update]);

      if (error) {
        console.error("Error inserting location update:", error);
      } else {
        // Debug: Log successful insertion details
        console.debug(
          "[updateLocation] Successfully inserted update:",
          supabaseData
        );
      }

      // Instead of broadcasting to everyone, you might choose to emit only to the room:
      io.to(roomId).emit("updateLocationResponse", data);
    }
  });

  socket.on("getLocationHistory", (data: { roomId: string }) => {
    const history = locationHistory[data.roomId] || [];

    // now we use in memory history for demo purpose
    socket.emit("locationHistory", { history });
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);

    const roomId = socket.roomId;
    if (roomId) {
      // if disconnected user is creator, destroy room
      if (roomCreator.get(roomId) === socket.id) {
        // notify users in room that room is destroyed
        const roomUsers = io.sockets.adapter.rooms.get(roomId);
        if (roomUsers) {
          for (const socketId of roomUsers) {
            io.to(`${socketId}`).emit("roomDestroyed", {
              status: "OK",
            });
          }
        }
        io.sockets.adapter.rooms.delete(roomId);
        roomCreator.delete(roomId);
      } else {
        socket.leave(roomId);
        // notify creator that user left room
        const creatorSocketId = roomCreator.get(roomId);
        if (creatorSocketId) {
          const creatorSocket = io.sockets.sockets.get(creatorSocketId);
          if (creatorSocket) {
            creatorSocket.emit("userLeftRoom", {
              userId: socket.id,
              totalConnectedUsers: Array.from(
                io.sockets.adapter.rooms.get(roomId) || []
              ),
            });
          }
        }
      }
    }
  });
});
