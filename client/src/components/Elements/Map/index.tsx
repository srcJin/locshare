// client/src/components/Elements/Map/index.tsx

import {useState, useEffect, useMemo} from 'react'
import { MapContainer, TileLayer, useMapEvents, Marker, Popup,  Polyline } from 'react-leaflet'
import { GeolocationPosition } from '../../../types'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
// import icon from 'leaflet/dist/images/marker-icon.png'
// import iconShadow from 'leaflet/dist/images/marker-shadow.png'
import { stringToColor } from '../../../utils/stringToColor'

function createUserIcon(nickname: string): L.DivIcon {
  const color = stringToColor(nickname);
  return L.divIcon({
    html: `
      <div style="display: flex; flex-direction: column; align-items: center;">
        <div style="background-color: ${color}; width: 16px; height: 16px; border-radius: 50%; border: 4px solid white; box-shadow: 0px 2px 4px rgba(0, 0, 0, 0.5);"></div>
        <div style="font-size: 16px; color: black; white-space: nowrap;">${nickname}</div>
      </div>
    `,
    className: "", // clear default styles
    iconSize: [20, 30],
    iconAnchor: [10, 15],
    popupAnchor: [0, -15],
  });
}

// let DefaultIcon = L.icon({
//     iconUrl: icon,
//     shadowUrl: iconShadow
// })

type LocationMarkerProps = {
  location: GeolocationPosition;
  nickname?: string;
};

type MapProps = {
  location: GeolocationPosition;
  history?: { lat: number; lng: number }[];
  nickname?: string;
};

function LocationMarker({location, nickname}: LocationMarkerProps) {

  const map = useMapEvents({})

  const [position, setPosition] = useState({
    lat: location.lat,
    lng: location.lng
  })

  const userIcon = useMemo(() => createUserIcon(nickname || "User"), [nickname]);

  
  useEffect(() => {
    setPosition({
      lat: location.lat,
      lng: location.lng,
    });
    map.flyTo([location.lat, location.lng]);
  }, [location, map]);

  return (
    <Marker position={position} icon={userIcon}>
      <Popup>
        {nickname ? nickname : "User"} <br /> (ID: {nickname ? "Custom" : "Default ID"})
      </Popup>
    </Marker>
  );
}


function Map({ location, history, nickname = "User" }: MapProps) {

  if(!location) return 'No location found'

  return (
    <div className='w-full bg-gray-100 h-[600px] md:h-[550px]'>
      <MapContainer center={[location.lat, location.lng]} zoom={30} scrollWheelZoom={true} className='h-screen'>
        <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
        <LocationMarker location={location} nickname={nickname} />
        {history && history.length > 0 && (
          <Polyline positions={history} />
        )}
      </MapContainer>
    </div>
  )
}

export default Map