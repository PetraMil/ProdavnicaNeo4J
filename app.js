const express = require('express');
const flash = require('connect-flash');
const session = require('express-session');
const path = require('path');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const passport = require('passport');
const neo4j = require('neo4j-driver');
const _ = require('lodash');

const {isAdmin, ensureAuthenticated, isAutorized} = require('./config/auth');

const app = express();
app.set('view engine', 'ejs');

require('./config/passport')(passport);

app.use(session({secret: 'secret', resave: true, saveUninitialized: true}));

app.use(passport.initialize());
app.use(passport.session());

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

app.use(express.urlencoded({extended: true}));

app.use(express.static(__dirname + "/public"));

app.use(flash());

app.use(function (req, res, next) {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.error = req.flash('error');
    next();
});

const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', '123456'));
const n4jsession = driver.session();

app.get('/', (req, res) => {
    res.render("home.ejs", {currentUser: req.user})
});

app.get('/register', (req, res) => {
    res.render("register.ejs", {currentUser: req.user})
});

app.get('/login', (req, res) => {
    res.render("login.ejs", {currentUser: req.user})
});

app.post('/register', (req, res) => {
    const {
        name,
        email,
        adresa,
        broj,
        password,
        password2
    } = req.body;
    let errors = [];

    if (!name || !email || !adresa || !broj || !password || !password2) {
        errors.push({msg: 'Popunite sva polja'});
    }

    if (password != password2) {
        errors.push({msg: 'Lozinke se ne poklapaju'});
    }

    if (password.length < 6) {
        errors.push({msg: 'Lozinka mora da ima bar 6 karaktera'});
    }

    if (errors.length > 0) {
        res.render("register.ejs", {
            errors,
            name,
            adresa,
            broj,
            email,
            password,
            password2,
            currentUser: req.user
        });
    } else {
        n4jsession.run('MATCH (user:User {email:$emailParam}) return user', {emailParam: email}).then(user => {
            if (! _.isEmpty(user.records)) {
                errors.push({msg: 'Korisnik sa unetim emailom već postoji'});
                res.render("register.ejs", {
                    errors,
                    name,
                    adresa,
                    broj,
                    email,
                    password,
                    password2,
                    currentUser: req.user
                });
            } else {
                bcrypt.genSalt(10, (err, salt) => {
                    bcrypt.hash(password, salt, (err, hash) => {
                        if (err) 
                            throw err;
                        


                        n4jsession.run('CREATE(user:User{ime:$nameParam, adresa:$adresaParam, telefon:$brojParam, email:$emailParam, sifra:$hashParam, tip:"kupac"}) return user', {
                            nameParam: name,
                            adresaParam: adresa,
                            brojParam: broj,
                            emailParam: email,
                            hashParam: hash
                        }).then(user => {
                            n4jsession.run('MATCH (u:User {email:$emailParam}) SET u.uid=toInteger($uidParam) CREATE(k:Korpa), (u)-[r:POSEDUJE]->(k)', {
                                emailParam: email,
                                uidParam: user.records[0]._fields[0].identity.low
                            }).then(u => {
                                req.flash('success_msg', 'Registrovani ste i možete se prijaviti');
                                res.redirect('/login');
                            });
                        }).catch(err => console.log(err));
                    })
                })
            }
        });
    }
});

app.post('/login', (req, res, next) => {
    passport.authenticate('local', {
        successRedirect: '/',
        failureRedirect: '/login',
        failureFlash: true
    })(req, res, next);
});

app.get('/logout', (req, res) => {
    req.logout();
    req.flash('success_msg', 'Odjavljeni ste');
    res.redirect('/login');
});

app.get('/tipovi', function (req, res) {
    n4jsession.run('MATCH(n:TipProizvoda) RETURN n').then(function (result) {
        var TipoviArr = [];
        result.records.forEach(function (record) {
            TipoviArr.push({id: record._fields[0].properties.tid, naziv: record._fields[0].properties.naziv});
        });
        res.render("tipovi.ejs", {
            tipovi: TipoviArr,
            currentUser: req.user
        });
    }).catch(function (err) {
        console.log(err);
    });
});

app.get('/proizvodi/:tid', (req, res) => {
    n4jsession.run('MATCH(tip:TipProizvoda {tid:toInteger($tidParam)})-[r:SADRZI]->(p:Proizvod) RETURN p', {tidParam: req.params.tid}).then(p => {
        var proizvodi = [];
        p.records.forEach(record => {
            proizvodi.push({
                id: record._fields[0].properties.pid,
                naziv: record._fields[0].properties.naziv,
                cena: record._fields[0].properties.cena,
                kolicina: record._fields[0].properties.kolicina,
                opis: record._fields[0].properties.opis,
                slika: record._fields[0].properties.slika
            })
        })
        n4jsession.run('MATCH(tip:TipProizvoda {tid:toInteger($tidParam)}) RETURN tip', {tidParam: req.params.tid}).then(tip => {
            res.render("proizvodi.ejs", {
                currentUser: req.user,
                proizvodi: proizvodi,
                tip: tip.records[0]._fields[0].properties
            })
        });
    }).catch(err => {
        console.log(err);
    })
});

app.get('/korpa/:uid', isAutorized, (req, res) => {
    n4jsession.run('MATCH(u:User {uid:toInteger($uidParam)})-[r:POSEDUJE]->(k:Korpa), (k)-[rel:IMA]->(p:Proizvod) RETURN p, rel', {uidParam: req.params.uid}).then(p => {
        var proizvodi = [];
        p.records.forEach(record => {
            proizvodi.push({
                id: record._fields[0].properties.pid,
                naziv: record._fields[0].properties.naziv,
                cena: (record._fields[0].properties.cena) * (record._fields[1].properties.kolicina),
                kolicinaKorpa: record._fields[1].properties.kolicina
            })
        })

        res.render("korpa.ejs", {
            currentUser: req.user,
            proizvodi: proizvodi
        })
    }).catch(err => {
        console.log(err);
    })
});

app.get("/tip/new", isAdmin, function (req, res) {
    res.render("dodajTip.ejs", {currentUser: req.user});
});

app.post("/tip/new", function (req, res) {
    n4jsession.run('MATCH(tip:TipProizvoda {naziv:$nazivParam}) RETURN tip', {nazivParam: req.body.naziv}).then(tip => {
        if (! _.isEmpty(tip.records)) {
            req.flash('error_msg', 'Uneti tip proizvoda već postoji!');
            res.redirect('/tip/new');
        } else {
            n4jsession.run('CREATE(n:TipProizvoda {naziv:$nazivParam}) RETURN n', {nazivParam: req.body.naziv}).then(n => {
                n4jsession.run('MATCH (t:TipProizvoda {naziv:$nazivParam}) SET t.tid=toInteger($tidParam)', {
                    nazivParam: req.body.naziv,
                    tidParam: n.records[0]._fields[0].identity.low
                }).then(t => {
                    req.flash('success_msg', 'Tip proizvoda je sačuvan!');
                    res.redirect('/tipovi');
                })
            }).catch(err => {
                console.log(err);
            });
        }
    }).catch(err => {
        console.log(err);
    });
});

app.get("/proizvod/new", isAdmin, function (req, res) {
    n4jsession.run('MATCH(tip:TipProizvoda) RETURN tip').then(tip => {
        var tipovi = [];
        tip.records.forEach(record => {
            tipovi.push({id: record._fields[0].properties.tid, naziv: record._fields[0].properties.naziv})
        });
        res.render("dodajProizvod.ejs", {
            currentUser: req.user,
            tipovi: tipovi
        });
    }).catch(err => {
        console.log(err)
    });
});

app.post("/proizvod/new", function (req, res) {
    n4jsession.run('MATCH(p:Proizvod {naziv:$nazivParam}) RETURN p', {nazivParam: req.body.naziv}).then(p => {
        if (! _.isEmpty(p.records)) {
            req.flash('error_msg', 'Proizvod sa unetim imenom već postoji!');
            res.redirect('/proizvod/new');
        } else {
            n4jsession.run('CREATE(proizvod:Proizvod {naziv:$nazivParam, opis:$opisParam, cena:$cenaParam, kolicina:$kolicinaParam, slika:$slikaParam}) return proizvod', {
                nazivParam: req.body.naziv,
                opisParam: req.body.opis,
                cenaParam: req.body.cena,
                kolicinaParam: req.body.kolicina,
                slikaParam: req.body.slika
            }).then(proizvod => {
                n4jsession.run('MATCH (proiz:Proizvod {naziv:$nazivParam}) SET proiz.pid=toInteger($pidParam)', {
                    nazivParam: req.body.naziv,
                    pidParam: proizvod.records[0]._fields[0].identity.low
                }).then(proiz => {
                    n4jsession.run('MATCH (pr:Proizvod), (tip:TipProizvoda) WHERE pr.naziv=$nazivParam AND tip.tid=toInteger($tidParam) CREATE(tip)-[r:SADRZI]->(pr) RETURN pr, tip', {
                        tidParam: req.body.tip,
                        nazivParam: req.body.naziv
                    }).then((pr, tip) => {
                        req.flash('success_msg', 'Proizvod je sačuvan!');
                        res.redirect('/proizvodi/' + req.body.tip);
                    });
                }).catch(err => {
                    console.log(err);
                });
            })
        }
    }).catch(err => {
        console.log(err);
    });
});

app.get("/proizvodi/:tid/proizvod/:id/edit", isAdmin, function (req, res) {
    n4jsession.run('MATCH(proizvod:Proizvod) WHERE proizvod.pid=toInteger($pidParam) RETURN proizvod', {pidParam: req.params.id}).then(proizvod => {
        if (_.isEmpty(proizvod.records)) {
            req.flash('error_msg', 'Ne postoji proizvod sa datim id-em!');
            res.redirect('/proizvodi/' + req.params.tid);
        } else {
            res.render("editProizvod.ejs", {
                currentUser: req.user,
                proizvod: proizvod.records[0]._fields[0].properties,
                tid: req.params.tid
            })
        }
    }).catch(err => {
        console.log(err);
    });
})

app.post("/proizvodi/:tid/proizvod/:id/edit", function (req, res) {
    n4jsession.run('MATCH(proizvod:Proizvod) WHERE proizvod.pid=toInteger($pidParam) SET proizvod.cena=$cenaParam, proizvod.kolicina=$kolicinaParam, proizvod.opis=$opisParam, proizvod.slika=$slikaParam RETURN proizvod', {
        pidParam: req.params.id,
        cenaParam: req.body.cena,
        kolicinaParam: req.body.kolicina,
        opisParam: req.body.opis,
        slikaParam: req.body.slika
    }).then(proizvod => {
        if (_.isEmpty(proizvod.records)) {
            req.flash('error_msg', 'Ne postoji proizvod sa datim id-em!');
            res.redirect('/proizvodi/' + req.params.tid);
        } else {
            req.flash('success_msg', 'Proizvod je izmenjen!');
            res.redirect('/proizvodi/' + req.params.tid);
        }
    }).catch(err => {
        console.log(err);
    });
})

app.post("/proizvodi/:tid/proizvod/:id/delete", isAdmin, function (req, res) {
    n4jsession.run('MATCH(proizvod:Proizvod) WHERE proizvod.pid=toInteger($pidParam) DETACH DELETE proizvod', {pidParam: req.params.id}).then(record => {
        req.flash('success_msg', 'Proizvod je obrisan!');
        res.redirect('/proizvodi/' + req.params.tid);
    }).catch(err => {
        console.log(err);
    });
})

app.post("/tipovi/:tid/delete", isAdmin, function (req, res) {
    n4jsession.run('MATCH(t:TipProizvoda {tid:toInteger($tidParam)}), (t)-[r:SADRZI]->(p) RETURN p', {tidParam: req.params.tid}).then(proizvod => {
        if(_.isEmpty(proizvod.records)){
            n4jsession.run('MATCH(t:TipProizvoda {tid:toInteger($tidParam)}) DETACH DELETE t', {tidParam: req.params.tid}).then(result=>{
                console.log(result);
                req.flash('success_msg', 'Tip je obrisan!');
                res.redirect('/tipovi');
            }).catch(err=>{console.log(err);})
        }else{
            n4jsession.run('MATCH(t:TipProizvoda {tid:toInteger($tidParam)}), (t)-[r:SADRZI]->(p) DETACH DELETE p, t', {tidParam: req.params.tid}).then(r=>{
                req.flash('success_msg', 'Tip je obrisan!');
                res.redirect('/tipovi');
            }).catch(err=>{console.log(err);})
        }
    }).catch(err => {
        console.log(err);
    })
})

app.post("/proizvodi/:tid/proizvod/:pid/dodaj/:uid", isAutorized, function (req, res) {
    n4jsession.run('MATCH(proizvod:Proizvod {pid:toInteger($pidParam)}) RETURN proizvod', {pidParam: req.params.pid}).then(proizvod => {
        if (proizvod.records[0]._fields[0].properties.kolicina == 0) {
            req.flash('error_msg', 'Nema više proizvoda na stanju!');
            res.redirect('/proizvodi/' + req.params.tid);
        } else {
            n4jsession.run('MATCH(u:User {uid:toInteger($uidParam)})-[r:POSEDUJE]->(k:Korpa), (p:Proizvod {pid:toInteger($pidParam)}), (k)-[rel:IMA]->(p) RETURN rel', {
                uidParam: req.params.uid,
                pidParam: req.params.pid
            }).then(rel => {
                if (! _.isEmpty(rel.records)) {
                    req.flash('error_msg', 'Proizvod već postoji u korpi!');
                    res.redirect('/korpa/' + req.params.uid);
                } else {
                    n4jsession.run('MATCH(u:User {uid:toInteger($uidParam)})-[r:POSEDUJE]->(k:Korpa), (p:Proizvod {pid:toInteger($pidParam)}) CREATE (k)-[rel:IMA {kolicina:1}]->(p) SET p.kolicina=toInteger($kolParam) RETURN rel', {
                        uidParam: req.params.uid,
                        pidParam: req.params.pid,
                        kolParam: parseInt(proizvod.records[0]._fields[0].properties.kolicina) - 1
                    }).then(r => {
                        req.flash('success_msg', 'Proizvod je dodat u korpu!');
                        res.redirect('/korpa/' + req.params.uid);
                    }).catch(err => {
                        console.log(err);
                    })
                }
            }).catch(err => {
                console.log(err);
            })
        }
    }).catch(err => {
        console.log(err);
    })
})

app.get("/:uid/povecaj/:pid/:kol", isAutorized, function (req, res) {
    var kolicina = parseInt(req.params.kol) + 1;
    n4jsession.run('MATCH(proizvod:Proizvod {pid:toInteger($pidParam)}) RETURN proizvod', {pidParam: req.params.pid}).then(proizvod => {
        if (proizvod.records[0]._fields[0].properties.kolicina == 0) {
            req.flash('error_msg', 'Nema više proizvoda na stanju!');
            res.redirect('/korpa/' + req.params.uid);
        } else {
            n4jsession.run('MATCH(u:User {uid:toInteger($uidParam)})-[r:POSEDUJE]->(k:Korpa), (p:Proizvod {pid:toInteger($pidParam)}), (k)-[rel:IMA]->(p) SET rel.kolicina=toInteger($kolicinaParam), p.kolicina=toInteger($kolParam) ', {
                uidParam: req.params.uid,
                pidParam: req.params.pid,
                kolicinaParam: kolicina,
                kolParam: parseInt(proizvod.records[0]._fields[0].properties.kolicina) - 1
            }).then(r => {
                res.redirect('/korpa/' + req.params.uid);
            }).catch(err => {
                console.log(err);
            })
        }
    }).catch(err => {
        console.log(err);
    })
})

app.get("/:uid/smanji/:pid/:kol", isAutorized, function (req, res) {
    var kolicina = parseInt(req.params.kol) - 1;
    n4jsession.run('MATCH(proizvod:Proizvod {pid:toInteger($pidParam)}) RETURN proizvod', {pidParam: req.params.pid}).then(proizvod => {
        if (kolicina == 0) {
            n4jsession.run('MATCH(u:User {uid:toInteger($uidParam)})-[r:POSEDUJE]->(k:Korpa), (p:Proizvod {pid:toInteger($pidParam)}), (k)-[rel:IMA]->(p) SET p.kolicina=toInteger($kolParam) DELETE rel', {
                uidParam: req.params.uid,
                pidParam: req.params.pid,
                kolParam: parseInt(proizvod.records[0]._fields[0].properties.kolicina) + 1
            }).then(record => {
                res.redirect('/korpa/' + req.params.uid);
            }).catch(err => {
                console.log(err);
            })
        } else {
            n4jsession.run('MATCH(u:User {uid:toInteger($uidParam)})-[r:POSEDUJE]->(k:Korpa), (p:Proizvod {pid:toInteger($pidParam)}), (k)-[rel:IMA]->(p) SET rel.kolicina=toInteger($kolicinaParam), p.kolicina=toInteger($kolParam) ', {
                uidParam: req.params.uid,
                pidParam: req.params.pid,
                kolicinaParam: kolicina,
                kolParam: parseInt(proizvod.records[0]._fields[0].properties.kolicina) + 1
            }).then(r => {
                res.redirect('/korpa/' + req.params.uid);
            }).catch(err => {
                console.log(err);
            })
        }
    }).catch(err => {
        console.log(err);
    })
})

app.post("/korpa/:uid/ukloni/:pid", function (req, res) {
    var kolicina;
    n4jsession.run('MATCH(p:Proizvod {pid:toInteger($pidParam)}), (k:Korpa)-[r:IMA]->(p) RETURN r, p', {pidParam: req.params.pid}).then(r => {
        kolicina = parseInt(r.records[0]._fields[0].properties.kolicina) + parseInt(r.records[0]._fields[1].properties.kolicina);
        n4jsession.run('MATCH(p:Proizvod {pid:toInteger($pidParam)}), (k:Korpa)-[r:IMA]->(p) SET p.kolicina=toInteger($kolParam) DELETE r', {
            pidParam: req.params.pid,
            kolParam: kolicina
        }).then(record => {
            req.flash('success_msg', 'Proizvod je uklonjen!');
            res.redirect('/korpa/' + req.params.uid);
        })
    }).catch(err => {
        console.log(err);
    })
})

app.get("/proizvodi/:tid/cena/najveca_prvo", (req, res) => {
    n4jsession.run('MATCH(tip:TipProizvoda {tid:toInteger($tidParam)})-[r:SADRZI]->(p:Proizvod) RETURN p ORDER BY toInteger(p.cena) DESC', {tidParam: req.params.tid}).then(p => {
        var proizvodi = [];
        p.records.forEach(record => {
            proizvodi.push({
                id: record._fields[0].properties.pid,
                naziv: record._fields[0].properties.naziv,
                cena: record._fields[0].properties.cena,
                kolicina: record._fields[0].properties.kolicina,
                opis: record._fields[0].properties.opis,
                slika: record._fields[0].properties.slika
            })
        })
        n4jsession.run('MATCH(tip:TipProizvoda {tid:toInteger($tidParam)}) RETURN tip', {tidParam: req.params.tid}).then(tip => {
            res.render("proizvodi.ejs", {
                currentUser: req.user,
                proizvodi: proizvodi,
                tip: tip.records[0]._fields[0].properties
            })
        });
    }).catch(err => {
        console.log(err);
    })
})

app.get("/proizvodi/:tid/cena/najmanja_prvo", (req, res) => {
    n4jsession.run('MATCH(tip:TipProizvoda {tid:toInteger($tidParam)})-[r:SADRZI]->(p:Proizvod) RETURN p ORDER BY toInteger(p.cena)', {tidParam: req.params.tid}).then(p => {
        var proizvodi = [];
        p.records.forEach(record => {
            proizvodi.push({
                id: record._fields[0].properties.pid,
                naziv: record._fields[0].properties.naziv,
                cena: record._fields[0].properties.cena,
                kolicina: record._fields[0].properties.kolicina,
                opis: record._fields[0].properties.opis,
                slika: record._fields[0].properties.slika
            })
        })
        n4jsession.run('MATCH(tip:TipProizvoda {tid:toInteger($tidParam)}) RETURN tip', {tidParam: req.params.tid}).then(tip => {
            res.render("proizvodi.ejs", {
                currentUser: req.user,
                proizvodi: proizvodi,
                tip: tip.records[0]._fields[0].properties
            })
        });
    }).catch(err => {
        console.log(err);
    })
})

app.listen(3000);
console.log('Server started on port 3000..');

module.exports = app;
