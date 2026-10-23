export interface UserObject { 
    steam_id?: string,
    name?: string,
    admin?: number,
    super_admin?: number,
    /** 1 when admin/super_admin come from the config lists (see the Steam login). */
    roles_from_config?: number,
    small_image?: string,
    medium_image?: string,
    large_image?: string,
    api_key?: string | undefined | null,
    challonge_api_key?: string | undefined | null,
    password?: string | null | undefined,
    /** Set once, when a Steam user adds a local login. */
    username?: string,
}