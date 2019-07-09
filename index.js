'use strict'

///////////////////////////////////////////////////////////
// Node imports, must be installed with npm install and
// packaged along the lambda code zip
//
///////////////////////////////////////////////////////////

const AWS = require('aws-sdk')          // AWS SDK
const suq = require('suq');             // OG Tag 파싱 라이브러리
const iconv = require('iconv-lite')     // Encoding 라이브러리
const charset = require('charset')      // headers charset Checker
const got = require('got');             // Http Request
const moment = require('moment');       // Date 라이브러리

AWS.config.update({
    region: 'ap-northeast-2'
})

// DynamoDB 클라이언트 생성
const docClient = new AWS.DynamoDB.DocumentClient()

// 공통 에러 코드
const INTERNAL_SERVER_ERROR = 500;
const INVALID_PARAMETERS = 400;
const SUCCESS = 200;

// DynamoDB Table Name
const TABLE_NAME = "OgTag"

///////////////////////////////////////////////////////////
// Lambda Handler, this is the method that gets invoked
// when the lambda server is triggered
//
///////////////////////////////////////////////////////////

exports.handler = async (event) => {

    // 오늘 날짜 ex) 20190709
    let date = new moment().format('YYYYMMDD');
    let targetUrl = ""
	let body = JSON.parse(event.body);
	
	console.log(body);
	console.log(body.url);
	
    if(body && body.url){
        targetUrl = body.url
    }
    else {
        // 파라미터 누락 시 에러 처리
        return errorResponse(INVALID_PARAMETERS, INVALID_PARAMETERS, "URL을 입력해주세요.")
    }

    // DynamoDB Key
    let date_url = date + "_" + targetUrl
    console.log(`parsing target url => ${targetUrl}`)

    // DynamoDB 검색 조건
    var params = {
        TableName: TABLE_NAME,
        Key: { date_url }
    };

    try {

        /*
        * 검색 조건으로 DynamoDB 검색 결과가 있는 경우, 결과 값 바로 리턴
        * 없는 경우, 새로 파싱하여 DynamoDB 저장 처리 후 결과 값 리턴
        * */
        let findResult = await docClient.get(params).promise();
        console.log(`findResult => ${JSON.stringify(findResult, null, 2)}`);

        if (findResult && findResult.Item) {
            return successResponse(findResult.Item.tag)
        } else {

            // encoding을 null로 요청하여 charset 라이브러리가 파싱한 encoding type으로 iconv encoding 처리
			let res = await got(targetUrl, { encoding : null })
			// let res = await request({url: targetUrl, encoding: null, resolveWithFullResponse: true}).promise();

            // http 요청 결과가 없는 경우 에러 처리
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

                        /*
                        opengraph Obj에서 ":" 구분자로 구분되어있는 Key값을 "_" 구분자로 변환하여 새로운 Obj 생성
                         */
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
                            TableName: TABLE_NAME,
                            Item: {
                                date_url,
                                "tag": resultData
                            }
                        };

                        await docClient.put(putParams).promise();
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

// Fail Result
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

// Success Result
var successResponse = function (body) {

    return {
        statusCode: SUCCESS,
        body: JSON.stringify(body),
        headers : { "Content-Type" : "application/json" }
    }
};
