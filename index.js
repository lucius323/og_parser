'use strict'

///////////////////////////////////////////////////////////
// Node imports, must be installed with npm install and
// packaged along the lambda code zip
//
///////////////////////////////////////////////////////////

const AWS = require('aws-sdk')
const suq = require('suq');
const iconv = require('iconv-lite')
const charset = require('charset')
const got = require('got');
const moment = require('moment');

AWS.config.update({
    region: 'ap-northeast-2'
})

const docClient = new AWS.DynamoDB.DocumentClient()
const INTERNAL_SERVER_ERROR = 500;
const INVALID_PARAMETERS = 400;
const SUCCESS = 200;

///////////////////////////////////////////////////////////
// Lambda Handler, this is the method that gets invoked
// when the lambda server is triggered
//
///////////////////////////////////////////////////////////
exports.handler = async (event) => {

    let date = new moment().format('YYYYMMDD');
    let targetUrl = ""
	let body = JSON.parse(event.body);
	
	console.log(body);
	console.log(body.url);
	
    if(body && body.url){
        targetUrl = body.url
    }
    else {
        return errorResponse(INVALID_PARAMETERS, INVALID_PARAMETERS, "URL을 입력해주세요.")
    }

    let date_url = date + "_" + targetUrl
    console.log(`parsing target url => ${targetUrl}`)

    var params = {
        TableName: "OgTag",
        Key: {date_url}
    };

    try {
        let findResult = await docClient.get(params).promise();
        console.log(`findResult => ${JSON.stringify(findResult, null, 2)}`);

        if (findResult && findResult.Item) {
            return successResponse(findResult.Item.tag)
        } else {

            
			let res = await got(targetUrl, { encoding : null })
			// let res = await request({url: targetUrl, encoding: null, resolveWithFullResponse: true}).promise();
			if (res && !res.body) return errorResponse(INTERNAL_SERVER_ERROR, INTERNAL_SERVER_ERROR, "페이지 정보를 찾을 수 없습니다.")
			const enc = charset(res.headers, res.body) // 해당 사이트의 charset값을 획득

			let i_result = ""
			if(enc){
				i_result = iconv.decode(res.body, enc)
			}
			else {
				res = await got(targetUrl)
				i_result = res.body
			}
            
            console.log(`i_result => ${i_result}`)

            return new Promise(function (resolve, reject) {
                suq.parse(i_result, async (err, result, body)=> {
                    if (err){
                        console.log(err)
                        reject({errMsg: err.message})
                    }
                    else if(Object.keys(result.opengraph).length === 0){
                        reject({errMsg: "메타 정보를 찾을 수 없습니다. "})
                    }
                    else {
                        let resultData = {}
                        Object.keys(result.opengraph).forEach(key=>{
                            let keyArr = key.split(":");
                            if(keyArr[1] && keyArr[2]){
                                resultData[`${keyArr[1]}_${keyArr[2]}`] = result.opengraph[key]
                            }
                            else if(keyArr[1] && !keyArr[2]){
                                resultData[`${keyArr[1]}`] = result.opengraph[key]
                            }

                        })

                        console.log(`resultData => ${JSON.stringify(resultData,null,2)}`)

                        let putParams = {
                            TableName: "OgTag",
                            Item: {
                                date_url,
                                "tag": resultData
                            }
                        };

                        let putResult = await docClient.put(putParams).promise();
                        console.log(`resultData => ${JSON.stringify(resultData, null, 2)}`);
                        resolve(resultData)
                    }
                })
            })
                .then(parseResult => {
                    console.log(`parseResult => ${JSON.stringify(parseResult, null, 2)}`)
                    return successResponse(parseResult)
                })
                .catch(e => {
                    return errorResponse(INTERNAL_SERVER_ERROR, INTERNAL_SERVER_ERROR ,e.errMsg);
                })


        }
    } catch (e) {
		console.log(`err => ${e}`)
		return (e.statusCode) ? errorResponse(INTERNAL_SERVER_ERROR, e.statusCode , e.message) : errorResponse(INTERNAL_SERVER_ERROR, INTERNAL_SERVER_ERROR ,e.message);       
		
    }
}


var errorResponse = function (statusCode,errorCode, detailMessage) {
    var messageMap = {
        400: 'Bad Request',
        401: 'Unauthonized',
        403: 'Forbidden',
        404: 'Not Found',
        405: 'Method Not Allowd',
        406: 'Not Acceptable',
        409: 'Conflict',
        500: 'Internal Server Error'
    };

    return {
        statusCode: statusCode,
        body: JSON.stringify({
            errorCode : errorCode,
            errorMessage : messageMap[errorCode],
            errorDetailMessage : detailMessage
        }),
        headers : { "Content-Type" : "application/json" }
    }
};

var successResponse = function (body) {

    return {
        statusCode: SUCCESS,
        body: JSON.stringify(body),
        headers : { "Content-Type" : "application/json" }
    }
};
