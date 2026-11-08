-- Profile photo: a small square JPEG (about 128x128) sent by the app as a data URL and kept in the row, so it can travel
-- inside the person cards (an <img> cannot send the bearer token, so there is no separate image route).
alter table profiles add column photo text
  check (photo is null or (photo ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+=*$' and char_length(photo) <= 60000));
