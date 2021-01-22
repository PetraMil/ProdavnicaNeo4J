module.exports = {
    ensureAuthenticated: function (req, res, next) {
        if (req.isAuthenticated()) {
            return next();
        }
        req.flash('error_msg', 'Morate biti prijavljeni za pristup!');
        res.redirect('/login');
    },
    isAdmin: function (req, res, next) {
        if (req.isAuthenticated()) {
            if (req.user.tip == "admin") {
                return next();
            } else {
                req.flash("error_msg", "Nemate pravo pristupa!");
                res.redirect('/');
            }
        } else {
            req.flash('error_msg', 'Morate biti prijavljeni za pristup!');
            res.redirect('/login');
        }
    },
    isAutorized: function (req, res, next) {
        if (req.isAuthenticated()) {
            if (req.params.uid==req.user.uid.low) {
                next();
            } else {
                req.flash("error_msg", "Nemate pravo pristupa!");
                res.redirect("/");
            }
        } else {
            req.flash("error_msg", "Morate biti prijavljeni za pristup!");
            res.redirect("/login");
        }
    },
};
