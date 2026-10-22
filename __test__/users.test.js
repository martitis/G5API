import { agent } from 'supertest';
import app from '../app.js'
const request = agent(app);
let adminCheck = 0;

describe("Test the user routes", () => {
  beforeAll(async () => {
    await request.get('/auth/steam/return')
      .expect(302);
      return;
  });
  it("Should get 200 from all users", () => {
    return request
      .get('/users')
      .expect(200);
  });
  it('Should return all users.', () => {
    return request.get('/users')
      .expect('Content-Type', /json/)
      .expect(200);
  });
  it('Should setup a new user only if we are an admin or super_admin.', () => {
    let newUserData = [{
      id: 1,
      steam_id: 1234,
      name: "Test User",
      admin: 0,
      super_admin: 0
    }];
    return request.post('/users').
      set('Content-Type', 'application/json').
      set('Accept', 'application/json').
      send(newUserData).
      expect(200);
  });
  it('Should get a user with a given database ID.', () => {
    return request.get('/users/1')
      .expect('Content-Type', /json/)
      .expect((res) => {
        expect(res.body.user.id).toEqual(1);
      })
      .expect(200);
    adminCheck = result.body.user.admin + result.body.user.super_admin;
  });
  it('Should get a users steam url from database ID or Steam ID.', () => {
    return request.get('/users/1/steam')
      .expect('Content-Type', /json/)
      .expect(200)
      .expect((res) => {
        expect(res.body.url).toMatch(/steamcommunity/);
      });
  });
  it('Should refuse admin rights for an account that never signed in with Steam.', async () => {
    // A separate client, so the super admin's session stays logged in.
    await agent(app)
      .post('/register')
      .set('Content-Type', 'application/json')
      .send({ username: "localonly", password: "localonly-pass", steam_id: "76561198000000777" })
      .expect(200);
    return request.put('/users')
      .set('Content-Type', 'application/json')
      .send([{ steam_id: "76561198000000777", admin: 1 }])
      .expect(412)
      .expect((res) => {
        expect(res.body.message).toMatch(/signed in with Steam/);
      });
  });
  it('Should list users with their roles for a super admin.', () => {
    return request.get('/admin/users')
      .expect(200)
      .expect((res) => {
        const me = res.body.users.find((user) => user.id === 1);
        expect(me.super_admin).toBe(1);
        expect(me.roles_from_config).toBe(1);
      });
  });
  it('Should save, replace, list and delete match templates.', async () => {
    const body = { name: "Scrim BO1", settings: { maps_to_win: 1, map_pool: ["de_nuke"], cvars: { mp_overtime_enable: 0 } } };
    const first = await request.post('/templates').set('Content-Type', 'application/json').send([body]).expect(200);
    const again = await request.post('/templates').set('Content-Type', 'application/json')
      .send([{ ...body, settings: { ...body.settings, maps_to_win: 3 } }]).expect(200);
    expect(again.body.id).toBe(first.body.id);
    const list = await request.get('/templates').expect(200);
    expect(list.body.templates).toHaveLength(1);
    expect(list.body.templates[0].settings).toMatchObject({ maps_to_win: 3, map_pool: ["de_nuke"], cvars: { mp_overtime_enable: "0" } });
    await request.post('/templates').set('Content-Type', 'application/json')
      .send([{ name: "Bad", settings: { cvars: { rcon_password: "x" } } }]).expect(412);
    await request.delete(`/templates/${first.body.id}`).expect(200);
    await request.delete(`/templates/${first.body.id}`).expect(404);
  });
  it('Should search the audit log text.', async () => {
    const hit = await request.get('/admin/audit?q=user.create').expect(200);
    expect(hit.body.total).toBeGreaterThan(0);
    const miss = await request.get('/admin/audit?q=no-such-entry-xyz').expect(200);
    expect(miss.body.total).toBe(0);
  });
  it('Should have written the user creation to the audit log.', () => {
    return request.get('/admin/audit?action=user.')
      .expect(200)
      .expect((res) => {
        expect(res.body.total).toBeGreaterThan(0);
        expect(res.body.entries[0]).toMatchObject({ action: expect.stringMatching(/^user\./), user_id: 1 });
      });
  });
  it('Should update the existing test user to remove admin privileges.', () => {
    let updatedUserData = [{
      id: 1,
      steam_id: '76561198025644194',
      name: "Get Updated Kid",
      admin: 0,
      super_admin: 0
    }];
    return request.put('/users')
    .set('Content-Type', 'application/json')
    .set('Accept', 'application/json')
    .send(updatedUserData)
    .expect(200);
  });
  it('Should attempt to create a user without permission.', async () => {
    let newUserData = [{
      id: 1,
      steam_id: 10001,
      name: "Bad Act0r",
      admin: 1,
      super_admin: 1
    }];
    return request.post('/users')
    .set('Content-Type', 'application/json')
    .set('Accept', 'application/json')
    .send(newUserData)
    .expect(403);
  });
});