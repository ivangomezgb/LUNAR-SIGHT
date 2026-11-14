import json
import math
import numpy as np
import pytest
from lln import dem, pano


def render(z, res, width=8, height=200, top=.2, bottom=-2., dmax=8000.):
    n = z.shape[0]
    d = np.zeros((height,width))
    normals = np.zeros((height,width,2),np.uint8)
    reach = pano.march_scale(z,-n*res/2,n*res/2,res,-math.pi/2,0.,
        dem.R_MOON_M+2,np.full(width,.001),dmax,d,normals,el_top=top,el_bottom=bottom)
    return d,normals,reach


def decode(v):
    xy = v.astype(float)/255*2-1
    n = np.concatenate([xy,(1-np.abs(xy).sum(axis=-1))[...,None]],axis=-1)
    fold = n[...,2] < 0
    n[fold,:2] = (1-np.abs(n[fold,:2][:,::-1]))*np.where(n[fold,:2]>=0,1,-1)
    return n/np.linalg.norm(n,axis=-1)[...,None]


def test_smooth_sphere():
    R = dem.R_MOON_M
    d,normals,reach = render(np.zeros((901,901),np.float32),20.)
    el = np.radians(.2-(np.arange(200)+.5)*2.2/200)
    horizon = -math.acos(R/(R+2))
    assert np.all(d[el > horizon] == 0)
    assert np.all(d[el < horizon] > 0)
    for row in [30,60,100,190]:
        b = -(R+2)*math.sin(el[row])
        expected = ((R+2)**2-R**2)/(b+math.sqrt(b*b-((R+2)**2-R**2)))
        assert np.allclose(d[row],expected,rtol=.01)
    assert np.all(reach == 8000)
    n = decode(normals[100])
    assert np.all(n[:,2] > .999)
    assert np.all(np.abs(n[:,:2]) < .01)


def test_wall_first_hit_and_normal():
    yy,xx = np.mgrid[:601,:601]
    radius = np.hypot(xx-300, yy-300)
    z = np.clip((radius-100)*20,0,20).astype(np.float32)
    d,normals,_ = render(z,1.,width=16,height=40,top=8,bottom=-8,dmax=250)
    for row in [0,10,20]:
        el = math.radians(8-(row+.5)*16/40)
        assert np.all(np.abs(d[row]*math.cos(el)-100) < 2)
    n = decode(normals[10])
    az = (np.arange(16)+.5)*2*math.pi/16
    assert np.all(n[:,0]*np.sin(az)+n[:,1]*np.cos(az) < -.9)


def test_nodata():
    d,n,r = render(np.full((101,101),np.nan,np.float32),10,dmax=200)
    assert not d.any()
    assert not n.any()
    assert np.all(r == .001)


SITES = json.loads((pano.DATA/'sites.json').read_text())


@pytest.mark.parametrize('site',SITES,ids=[s['id'] for s in SITES])
def test_real_contract_and_horizon(site):
    sid = site['id']
    path = pano.DATA/'pano'/f'{sid}.json'
    if not path.exists():
        pytest.skip('Generate real panoramas with python -m lln.pano')
    meta = json.loads(path.read_text())
    assert meta['width'] in (1536,2048)
    assert meta['height'] == 400
    assert meta['observer_height_m'] == 2
    assert meta['dist']['unit_m'] == 4
    shape = meta['height'],meta['width']
    d = np.fromfile(path.parent/meta['dist']['file'],dtype='<u2').reshape(shape)
    n = np.fromfile(path.parent/meta['normal']['file'],dtype='u1').reshape(*shape,2)
    assert np.all(n[d == 0] == 0)
    assert np.all(np.diff((d>0).astype(int),axis=0) >= 0)
    data = json.loads((pano.DATA/'sites'/f'{sid}.json').read_text())
    report = pano.boundary_report(d,data)
    assert report['within_0_2_deg_pct'] >= 99, report
