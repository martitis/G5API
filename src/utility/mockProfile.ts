/** The Steam profile the mock login (tests only) signs in as. Not a real person; the ID only has the SteamID64 format. */
export default class user {
  id = "76561198000000042";
  displayName = "Test Admin";
  // Steam's default avatar.
  photos = [
    { value: "https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb.jpg" },
    { value: "https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_medium.jpg" },
    { value: "https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg" }
  ];
  identifier = "https://steamcommunity.com/openid/id/76561198000000042";
  super_admin = 1;
  admin = 1;
}
