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
  console.log(`Server is running on port ${port}`);
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
  console.log(`User connected: ${socket.id}, nickname: ${socket.nickname}`);

  socket.on("joinRoom", async (data: { roomId: string; nickname?: string; position?: any }) => {
    const { roomId } = data;
    const nickname = data.nickname || socket.id;

    // Check if that room already exists
    const roomExists = io.sockets.adapter.rooms.has(roomId);

    if (!roomExists) {
      // 1) CREATE A NEW ROOM
      socket.join(roomId);
      socket.roomId = roomId;
      socket.nickname = nickname;

      // Mark this user as the creator
      roomCreator.set(roomId, socket.id);

      // Initialize empty location history for this room
      locationHistory[roomId] = [];

      // If they have an initial position, record that
      if (data.position) {
        await recordLocationUpdate(roomId, socket, data.position);
      }

      console.log(`[joinRoom] Created new room '${roomId}' with creator ${socket.id} nickname '${socket.nickname}`);
      io.to(socket.id).emit("roomJoined", {
        status: "OK",
        nickname: socket.nickname,
        roomId: roomId,
      });
    } else {
      // 2) ROOM ALREADY EXISTS --> JOIN
      socket.join(roomId);
      socket.roomId = roomId;
      socket.nickname = nickname;

      console.log(`[joinRoom] '${socket.id}' nickname '${socket.nickname}' joined existing room '${roomId}'`);

      // Let the creator know that a new user joined (if it’s truly a new user)
      const creatorSocketID = roomCreator.get(roomId);
      if (creatorSocketID && creatorSocketID !== socket.id) {
        const totalRoomUsers = io.sockets.adapter.rooms.get(roomId);
        io.to(creatorSocketID).emit("userJoinedRoom", {
          userId: socket.id,
          nickname: socket.nickname,
          totalConnectedUsers: Array.from(totalRoomUsers || []),
        });
      }

      // If user wants to “continue” and had a prior location, that’s up to how you store sessions.
      // For simplicity, we do nothing special. They’re just joined again.

      // Notify that the join was successful
      io.to(socket.id).emit("roomJoined", {
        status: "OK",
        nickname: socket.nickname,
        roomId: roomId,
      });
    }
  });

  /**
   * Whenever a user’s location changes, record it in memory and in DB, then broadcast to the room.
   */
  socket.on("updateLocation", async (data) => {
    const roomId = socket.roomId;
    if (!roomId) return;

    console.debug("[updateLocation]", `User ${socket.id} => roomId: ${roomId}`, data);

    await recordLocationUpdate(roomId, socket, data.position);

    // Broadcast the new location to all members of the same room
    io.to(roomId).emit("updateLocationResponse", data);
  });

  /**
   * If the front-end requests a location history, we pull from in-memory object.
   * In production, you might load from the DB instead.
   */
  socket.on("getLocationHistory", (data: { roomId: string }) => {
    const history = locationHistory[data.roomId] || [];
    socket.emit("locationHistory", { history });
  });

  /**
   * On disconnect, check if this user was the “creator” for the room. If so, destroy the room.
   */
  socket.on("disconnect", () => {
    console.log(`room: ${socket.roomId} User disconnected: ${socket.id},  nickname: ${socket.nickname}`);

    const roomId = socket.roomId;
    if (roomId) {
      // If disconnected user is the room creator, destroy the room for everyone
      if (roomCreator.get(roomId) === socket.id) {
        // notify users in the room that the room is destroyed
        const roomUsers = io.sockets.adapter.rooms.get(roomId);
        if (roomUsers) {
          for (const socketId of roomUsers) {
            io.to(socketId).emit("roomDestroyed", { status: "OK" });
          }
        }
        // forcibly remove the room from the adapter
        io.sockets.adapter.rooms.delete(roomId);
        // remove from the roomCreator map
        roomCreator.delete(roomId);
      } else {
        // Just a normal user leaving the room
        socket.leave(roomId);

        // Let the creator know a user left
        const creatorSocketId = roomCreator.get(roomId);
        if (creatorSocketId) {
          const creatorSocket = io.sockets.sockets.get(creatorSocketId);
          if (creatorSocket) {
            const totalConnectedUsers = io.sockets.adapter.rooms.get(roomId);
            creatorSocket.emit("userLeftRoom", {
              userId: socket.id,
              totalConnectedUsers: Array.from(totalConnectedUsers || []),
            });
          }
        }
      }
    }
  });

  // A helper function to record an incoming location update in memory + DB + JSON file
  async function recordLocationUpdate(roomId: string, socket: CustomSocket, position: any) {
    if (!position) return;

    // Build the location update object
    const update = {
      room_id: roomId,
      user_id: socket.id,
      nickname: socket.nickname || socket.id,
      position,
      timestamp: new Date().toISOString(),
    };

    // Add it to in-memory array
    locationHistory[roomId].push(update);

    // Also write the entire locationHistory object to disk (for demo)
    fs.writeFile("location_history.json", JSON.stringify(locationHistory, null, 2), (err) => {
      if (err) {
        console.error("Error writing location history:", err);
      }
    });

    // Insert into Supabase DB
    try {
      const { data: supabaseData, error } = await supabase
        .from("url_evacuation_location_history")
        .insert([update]);

      if (error) {
        console.error("Error inserting location update:", error);
      } else {
        console.debug("[recordLocationUpdate] Inserted record:", supabaseData);
      }
    } catch (err) {
      console.error("[recordLocationUpdate] Supabase insert error:", err);
    }
  }
});
