import { weatherFeed } from '../../../lib/weather-feed';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:Request) {
  const sport=new URL(request.url).searchParams.get('sport');
  if(sport!=='NFL'&&sport!=='CFB'&&sport!=='MLB')return Response.json({error:'Unsupported weather sport'},{status:400});
  try{return Response.json(await weatherFeed(sport));}
  catch{return Response.json({games:[],warning:'Weather data unavailable; no conditions were assumed.',checked_at:new Date().toISOString()});}
}
