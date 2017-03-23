var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var request = require('superagent');
var index = require('./routes/index');
var weibo = require('./routes/weibo');
var v1 = require('./routes/v1');
// express的消息提示中间件
var flash = require('express-flash');

// 定时器
var schedule = require('node-schedule');

// 各种工具类
var dbUtils = require('./utils/dbUtils');
var bingUtils = require('./utils/bingUtils');
var mailUtils = require('./utils/mailUtils');
var qiniuUtils = require('./utils/qiniuUtils');
var weiboUtils = require('./utils/weiboUtils');

var app = express();
app.disable('x-powered-by');
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use(favicon(__dirname + '/static/images/bing.ico'));
// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');
app.enable('trust proxy');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(cookieParser());
// 设置日志
app.use(logger('combined', {
    skip: function(req, res) { return res.statusCode < 400 }
}));
app.use(flash());

// 每天 00:00,00:10,00:20 检测bing数据
schedule.scheduleJob('0 0,10,20 0 * * *', function() {
    var date = new Date();
    var year = date.getFullYear();
    var month = date.getMonth() + 1;
    var day = date.getDate();
    var now = year + '' + (month < 10 ? '0' + month : month) + '' + (day < 10 ? '0' + day : day);
    // 查询是否已经抓取并插入数据库，如果已插入就不重复抓取
    dbUtils.get('bing', {
        body: {
            enddate: now
        }
    }, function(rows) {
        if (rows.length === 0) {
            bingUtils.fetchPicture({}, function(data) {
                dbUtils.set('bing', data, function(rows) {
                    data.id = rows.insertId || 0;
                    mailUtils.send({
                        message: '从Bing抓取成功',
                        title: '从Bing抓取成功',
                        stack: JSON.stringify(data, '', 4)
                    });
                })
            });
        }
    });
});
// 每天 09:30,12:30,15:30,18:30,21:30 定时发送微博
schedule.scheduleJob('0 30 9,12,15,18,21 * * *', function() {
    weiboUtils.update(function(data) {
        if (data && data.id) {
            mailUtils.send({
                message: '发送微博成功',
                title: '发送微博成功',
                stack: JSON.stringify(data, '', 4)
            });
        } else {
            mailUtils.send({
                message: '发送微博失败',
                title: '发送微博失败',
                stack: JSON.stringify(data, '', 4)
            });
        }
    }, true);
});

// 每隔五分钟检查数据库中是否存在未上传到骑牛的图片，如果存在则上传图片到骑牛
schedule.scheduleJob('0 1,6,11,16,21,26,31,36,41,46,51,56 * * * *', function() {
    dbUtils.get('bing', 'ISNULL(qiniu_url) || qiniu_url=""', function(rows) {
        if (rows.length > 0) {
            var data = rows[0];
            var url = data.url;
            qiniuUtils.fetchToQiniu(url, function() {
                var _temp = url.substr(url.lastIndexOf('/') + 1, url.length);
                var qiniu_url = _temp.substr(0, _temp.lastIndexOf('_'));
                dbUtils.update('bing', {
                    body: {
                        qiniu_url: qiniu_url
                    },
                    condition: {
                        id: data.id
                    }
                }, function(rs) {
                    // nsole.log(rs);
                });
            });
        }
    });
})

/**
 * 处理OPTIONS请求
 */
app.use(function(req, res, next) {
    // 
    if (req.method === 'OPTIONS') {
        res.send(200);
    } else next();
});

app.use('/', index);
app.use('/weibo', weibo);
app.use('/v1', v1);

/**
 * Robots.txt
 */
app.use('/robots.txt', function(req, res, next) {
    res.header('content-type', 'text/plain');
    res.send('User-Agent: * \nAllow: /');
});
app.get('/test', function(req, res, next) {
    var images = [];
    bingUtils.fetchPicture(function(data) {
        var enddate = req.query.d || data.enddate;
        dbUtils.get('bing', {
            enddate: enddate
        }, function(data) {
            res.send(data);
        });
    });
});


// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('啊( ⊙ o ⊙ )，你发现了新大陆 ∑(っ °Д °;)っ');
    err.status = 404;
    next(err);
});
// error handlers
// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}
// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});
module.exports = app;